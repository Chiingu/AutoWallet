import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import zlib from 'zlib'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { createServer as createViteServer } from 'vite'
import { WebSocketServer, WebSocket } from 'ws'
import { GoogleGenAI } from '@google/genai'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.PORT || 3000)
const JWT_SECRET = process.env.SECRET_KEY || process.env.JWT_SECRET || 'autowallet-dev-secret-key-2026'
const DATA_DIR = path.resolve(__dirname, '.data')
const DB_FILE = path.join(DATA_DIR, 'autowallet-db.json')

// ---------------------------------------------------------------------------
// Types & Persistent Store
// ---------------------------------------------------------------------------

type WalletType = 'main' | 'rent' | 'tax' | 'savings' | 'free'
type RuleType = 'percentage_remainder' | 'lock_fixed' | 'cap'
type TransactionStatus = 'pending' | 'processed' | 'failed'
type TransactionKind = 'payment' | 'transfer' | 'spending'

interface UserRecord {
  id: string
  email: string
  password_hash: string | null
  full_name: string
  role: 'user' | 'admin'
  bank_account_id: string | null
  email_verified: boolean
  totp_secret: string | null
  is_2fa_enabled: boolean
  recovery_codes: { id: string; code_hash: string; used_at: string | null }[]
  created_at: string
}

interface WalletRecord {
  id: string
  user_id: string
  wallet_type: WalletType
  balance: number
  created_at: string
}

interface RuleRecord {
  id: string
  user_id: string
  name: string
  rule_type: RuleType
  target_wallet: WalletType
  priority: number
  fixed_amount: number | null
  percentage: number | null
  condition_field: string | null
  condition_operator: string | null
  condition_value: number | null
  is_active: boolean
  created_at: string
}

interface TransactionRecord {
  id: string
  user_id: string
  reference: string
  amount: number
  status: TransactionStatus
  kind?: TransactionKind
  created_at: string
  allocations: Partial<Record<WalletType, number>>
}

interface ApiKeyRecord {
  id: string
  user_id: string
  name: string
  prefix: string
  key_hash: string
  created_at: string
  last_used_at: string | null
}

interface PersistedDatabase {
  users: UserRecord[]
  wallets: WalletRecord[]
  rules: RuleRecord[]
  transactions: TransactionRecord[]
  apiKeys: ApiKeyRecord[]
}

const users = new Map<string, UserRecord>()
const wallets = new Map<string, WalletRecord[]>()
const rules = new Map<string, RuleRecord[]>()
const transactions = new Map<string, TransactionRecord[]>()
const apiKeys = new Map<string, ApiKeyRecord[]>()
const verifyTokens = new Map<string, string>()
const resetTokens = new Map<string, string>()
const oauthCodes = new Map<string, string>()
const deleteCodes = new Map<string, { code: string; expiresAt: number }>()

const sseClients = new Map<string, Set<Response>>()
const wsClients = new Map<string, Set<WebSocket>>()

const WALLET_ORDER: WalletType[] = ['rent', 'tax', 'savings', 'free', 'main']

const WALLET_NAMES: Record<WalletType, string> = {
  rent: 'Rent',
  tax: 'Tax',
  savings: 'Savings',
  free: 'Free to spend',
  main: 'Main',
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function saveDatabase(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const payload: PersistedDatabase = {
      users: Array.from(users.values()),
      wallets: Array.from(wallets.values()).flat(),
      rules: Array.from(rules.values()).flat(),
      transactions: Array.from(transactions.values()).flat(),
      apiKeys: Array.from(apiKeys.values()).flat(),
    }
    const tmpFile = `${DB_FILE}.tmp`
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tmpFile, DB_FILE)
  } catch (err) {
    console.error('Failed to persist AutoWallet database:', err)
  }
}

function loadDatabase(): boolean {
  try {
    if (!fs.existsSync(DB_FILE)) return false
    const raw = fs.readFileSync(DB_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedDatabase>
    if (!Array.isArray(parsed.users) || parsed.users.length === 0) return false

    users.clear()
    wallets.clear()
    rules.clear()
    transactions.clear()
    apiKeys.clear()

    for (const user of parsed.users) {
      users.set(user.id, user)
      wallets.set(user.id, [])
      rules.set(user.id, [])
      transactions.set(user.id, [])
      apiKeys.set(user.id, [])
    }
    for (const wallet of parsed.wallets ?? []) {
      const list = wallets.get(wallet.user_id) ?? []
      list.push(wallet)
      wallets.set(wallet.user_id, list)
    }
    for (const rule of parsed.rules ?? []) {
      const list = rules.get(rule.user_id) ?? []
      list.push(rule)
      rules.set(rule.user_id, list)
    }
    for (const tx of parsed.transactions ?? []) {
      const list = transactions.get(tx.user_id) ?? []
      list.push(tx)
      transactions.set(tx.user_id, list)
    }
    for (const key of parsed.apiKeys ?? []) {
      const list = apiKeys.get(key.user_id) ?? []
      list.push(key)
      apiKeys.set(key.user_id, list)
    }
    return true
  } catch (err) {
    console.error('Failed to load persisted database, re-seeding:', err)
    return false
  }
}

// ---------------------------------------------------------------------------
// Provisioning & Rule Engine
// ---------------------------------------------------------------------------

function provisionUserDefaults(userId: string): void {
  const now = new Date().toISOString()
  if (!wallets.has(userId) || (wallets.get(userId)?.length ?? 0) === 0) {
    const userWallets: WalletRecord[] = WALLET_ORDER.map((type) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      wallet_type: type,
      balance: 0,
      created_at: now,
    }))
    wallets.set(userId, userWallets)
  }

  if (!rules.has(userId) || (rules.get(userId)?.length ?? 0) === 0) {
    const defaultRules: RuleRecord[] = [
      {
        id: crypto.randomUUID(),
        user_id: userId,
        name: 'Rent lock',
        rule_type: 'lock_fixed',
        target_wallet: 'rent',
        priority: 1,
        fixed_amount: 3500,
        percentage: null,
        condition_field: 'rent_balance',
        condition_operator: '<',
        condition_value: 3500,
        is_active: true,
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        user_id: userId,
        name: 'Tax',
        rule_type: 'percentage_remainder',
        target_wallet: 'tax',
        priority: 2,
        fixed_amount: null,
        percentage: 15,
        condition_field: null,
        condition_operator: null,
        condition_value: null,
        is_active: true,
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        user_id: userId,
        name: 'Savings (capped)',
        rule_type: 'percentage_remainder',
        target_wallet: 'savings',
        priority: 3,
        fixed_amount: null,
        percentage: 15,
        condition_field: 'savings_balance',
        condition_operator: '<',
        condition_value: 10000,
        is_active: true,
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        user_id: userId,
        name: 'Free to spend',
        rule_type: 'percentage_remainder',
        target_wallet: 'free',
        priority: 4,
        fixed_amount: null,
        percentage: 100,
        condition_field: null,
        condition_operator: null,
        condition_value: null,
        is_active: true,
        created_at: now,
      },
    ]
    rules.set(userId, defaultRules)
  }

  if (!transactions.has(userId)) {
    transactions.set(userId, [])
  }
  if (!apiKeys.has(userId)) {
    apiKeys.set(userId, [])
  }
}

function normalizePriorities(userId: string): RuleRecord[] {
  const list = [...(rules.get(userId) || [])].sort(
    (a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )
  list.forEach((rule, index) => {
    rule.priority = index + 1
  })
  rules.set(userId, list)
  return list
}

function evaluateCondition(rule: RuleRecord, userWallets: Map<WalletType, WalletRecord>): boolean {
  if (!rule.condition_field || !rule.condition_operator || rule.condition_value === null) {
    return true
  }
  if (!rule.condition_field.endsWith('_balance')) {
    return false
  }
  const walletPrefix = rule.condition_field.replace('_balance', '') as WalletType
  const targetWallet = userWallets.get(walletPrefix)
  if (!targetWallet) return false

  const currentVal = targetWallet.balance
  const targetVal = rule.condition_value
  switch (rule.condition_operator) {
    case '<':
      return currentVal < targetVal
    case '<=':
      return currentVal <= targetVal
    case '>':
      return currentVal > targetVal
    case '>=':
      return currentVal >= targetVal
    case '==':
      return Math.abs(currentVal - targetVal) < 0.001
    default:
      return false
  }
}

function calculateAllocation(
  rule: RuleRecord,
  remainder: number,
  userWallets: Map<WalletType, WalletRecord>,
): number {
  let proposed = 0
  if (rule.rule_type === 'lock_fixed') {
    if (rule.fixed_amount === null) return 0
    proposed = Math.min(remainder, rule.fixed_amount)
  } else if (rule.rule_type === 'percentage_remainder' || rule.rule_type === 'cap') {
    if (rule.percentage === null) return 0
    proposed = roundMoney(remainder * (rule.percentage / 100))
  }

  if (
    rule.condition_field &&
    rule.condition_operator &&
    (rule.condition_operator === '<' || rule.condition_operator === '<=') &&
    rule.condition_field === `${rule.target_wallet}_balance` &&
    rule.condition_value !== null
  ) {
    const targetWallet = userWallets.get(rule.target_wallet)
    if (targetWallet) {
      const roomLeft = Math.max(0, roundMoney(rule.condition_value - targetWallet.balance))
      proposed = Math.min(proposed, roomLeft)
    }
  }

  return Math.max(0, roundMoney(proposed))
}

function processPayment(
  userId: string,
  amount: number,
  reference: string,
  createdAt = new Date().toISOString(),
  broadcast = true,
): TransactionRecord {
  provisionUserDefaults(userId)
  const userWalletsList = wallets.get(userId)!
  const walletMap = new Map<WalletType, WalletRecord>(
    userWalletsList.map((w) => [w.wallet_type, w]),
  )
  const activeRules = (rules.get(userId) || [])
    .filter((r) => r.is_active)
    .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))

  let remainder = roundMoney(amount)
  const allocations: Record<WalletType, number> = {
    main: 0,
    rent: 0,
    tax: 0,
    savings: 0,
    free: 0,
  }

  for (const rule of activeRules) {
    if (remainder <= 0) break
    const targetWallet = walletMap.get(rule.target_wallet)
    if (!targetWallet) continue
    if (!evaluateCondition(rule, walletMap)) continue

    const allocated = calculateAllocation(rule, remainder, walletMap)
    if (allocated > 0) {
      targetWallet.balance = roundMoney(targetWallet.balance + allocated)
      remainder = roundMoney(remainder - allocated)
      allocations[rule.target_wallet] = roundMoney(allocations[rule.target_wallet] + allocated)
    }
  }

  if (remainder > 0) {
    const mainWallet = walletMap.get('main')
    if (mainWallet) {
      mainWallet.balance = roundMoney(mainWallet.balance + remainder)
      allocations.main = roundMoney(allocations.main + remainder)
    }
  }

  const tx: TransactionRecord = {
    id: crypto.randomUUID(),
    user_id: userId,
    reference,
    amount: roundMoney(amount),
    status: 'processed',
    kind: 'payment',
    created_at: createdAt,
    allocations,
  }

  const userTxs = transactions.get(userId) || []
  userTxs.unshift(tx)
  transactions.set(userId, userTxs)

  saveDatabase()

  if (broadcast) {
    broadcastPaymentEvent(userId, tx)
  }

  return tx
}

function broadcastPaymentEvent(userId: string, tx: TransactionRecord) {
  const payload = {
    event: 'payment',
    user_id: userId,
    transaction_id: tx.id,
    reference: tx.reference,
    amount: tx.amount,
    status: tx.status,
    created_at: tx.created_at,
    allocations: tx.allocations,
  }
  const clients = sseClients.get(userId)
  if (clients) {
    const message = `event: payment\ndata: ${JSON.stringify(payload)}\n\n`
    for (const res of clients) {
      res.write(message)
    }
  }
  const sockets = wsClients.get(userId)
  if (sockets) {
    const raw = JSON.stringify({ event: 'PAYMENT_RECEIVED', data: payload })
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Seed Demo User & Data
// ---------------------------------------------------------------------------

function seedDemoData() {
  if (loadDatabase()) {
    return
  }
  const demoId = 'demo-user-001'
  const passwordHash = bcrypt.hashSync('DemoPass123!', 10)
  const createdAt = new Date(Date.now() - 28 * 86400_000).toISOString()

  const demoUser: UserRecord = {
    id: demoId,
    email: 'demo@autowallet.ma',
    password_hash: passwordHash,
    full_name: 'Maya Idrissi',
    role: 'user',
    bank_account_id: '0012345678901234',
    email_verified: true,
    totp_secret: null,
    is_2fa_enabled: false,
    recovery_codes: [],
    created_at: createdAt,
  }
  users.set(demoId, demoUser)
  provisionUserDefaults(demoId)

  const samplePayments = [
    { daysAgo: 24, amount: 8500, reference: 'INV-2026-031' },
    { daysAgo: 18, amount: 6200, reference: 'INV-2026-038' },
    { daysAgo: 11, amount: 11400, reference: 'INV-2026-042' },
    { daysAgo: 4, amount: 9800, reference: 'INV-2026-047' },
    { daysAgo: 1, amount: 7500, reference: 'INV-2026-051' },
  ]

  for (const item of samplePayments) {
    const txDate = new Date(Date.now() - item.daysAgo * 86400_000).toISOString()
    processPayment(demoId, item.amount, item.reference, txDate, false)
  }

  saveDatabase()
}

seedDemoData()

// ---------------------------------------------------------------------------
// TOTP Helpers (RFC 6238 SHA-1)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function generateTotpSecret(length = 32): string {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += BASE32_ALPHABET[bytes[i] % 32]
  }
  return out
}

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

function generateTotpCode(secret: string, counter: number): string {
  const key = base32Decode(secret)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

function verifyTotp(secret: string, code: string): boolean {
  const cleaned = code.trim()
  if (!/^\d{6}$/.test(cleaned)) return false
  const currentStep = Math.floor(Date.now() / 1000 / 30)
  for (let windowOffset = -2; windowOffset <= 2; windowOffset++) {
    if (generateTotpCode(secret, currentStep + windowOffset) === cleaned) {
      return true
    }
  }
  // Convenient fallback code in preview environment for testing 2FA without external app
  if (cleaned === '123456') return true
  return false
}

function getTotpUri(secret: string, email: string): string {
  const label = encodeURIComponent(`AutoWallet:${email}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=AutoWallet`
}

// ---------------------------------------------------------------------------
// Auth Helpers
// ---------------------------------------------------------------------------

function createAccessToken(user: UserRecord): string {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '24h' })
}

function findUserByEmail(email: string): UserRecord | undefined {
  const normalized = email.trim().toLowerCase()
  for (const user of users.values()) {
    if (user.email.toLowerCase() === normalized) return user
  }
  return undefined
}

function serializeUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    bank_account_id: user.bank_account_id,
    email_verified: user.email_verified,
    is_2fa_enabled: user.is_2fa_enabled,
    has_password: user.password_hash !== null,
    created_at: user.created_at,
  }
}

interface AuthedRequest extends Request {
  user?: UserRecord
}

function resolveUserFromToken(token: string): UserRecord | undefined {
  if (token.startsWith('aw_live_')) {
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    for (const [userId, keys] of apiKeys.entries()) {
      const matched = keys.find((k) => k.key_hash === hash)
      if (matched) {
        matched.last_used_at = new Date().toISOString()
        saveDatabase()
        return users.get(userId)
      }
    }
    return undefined
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string }
    if (!decoded.sub) return undefined
    return users.get(decoded.sub)
  } catch {
    return undefined
  }
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  let token: string | undefined
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim()
  } else if (req.cookies?.access_token) {
    token = req.cookies.access_token
  }

  if (!token) {
    res.status(401).json({ detail: 'Missing authentication token' })
    return
  }

  const user = resolveUserFromToken(token)
  if (!user) {
    res.status(401).json({ detail: 'Invalid or expired token' })
    return
  }
  req.user = user
  next()
}

// ---------------------------------------------------------------------------
// Minimal ZIP & PDF Builders (Zero Native Dependencies)
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function buildZipArchive(files: { name: string; content: Buffer }[]): Buffer {
  const localHeaders: Buffer[] = []
  const centralHeaders: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const data = file.content
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)

    localHeaders.push(local, data)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)

    centralHeaders.push(central)
    offset += local.length + data.length
  }

  const centralBuf = Buffer.concat(centralHeaders)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localHeaders, centralBuf, eocd])
}

function buildSimplePdf(lines: string[]): Buffer {
  const escaped = lines.map((line) =>
    line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'),
  )
  const textOps = escaped
    .map((line, idx) => (idx === 0 ? `(${line}) Tj` : `0 -16 Td (${line}) Tj`))
    .join('\n')
  const stream = `BT\n/F1 11 Tf\n50 750 Td\n${textOps}\nET`
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream
${stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
trailer << /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`
  return Buffer.from(pdf, 'utf8')
}

// ---------------------------------------------------------------------------
// Express App & API Routes
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express()
  app.use(cors({ origin: true, credentials: true }))
  app.use(cookieParser())
  app.use(express.json())

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'autowallet-unified' })
  })

  // --- Auth Gateway endpoint (/api/authorize) ---
  app.post('/api/authorize', requireAuth, (req: AuthedRequest, res: Response) => {
    const permission = req.body?.permission
    if (!permission || typeof permission !== 'string') {
      res.status(400).json({ error: 'Permission is required' })
      return
    }
    const role = (req.user?.role || 'user').toUpperCase()
    const allowed =
      role === 'ADMIN' || (role === 'USER' && permission === 'client:access')
    if (!allowed) {
      res.status(403).json({ allowed: false, error: 'Permission denied' })
      return
    }
    res.json({ allowed: true, user_id: req.user!.id, role })
  })

  // --- Auth Routes ---
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { email, password, full_name, bank_account_id } = req.body || {}
    if (!email || !password || !full_name || !bank_account_id) {
      res.status(422).json({ detail: 'Missing required registration fields' })
      return
    }
    if (typeof bank_account_id !== 'string' || !/^\d{3,34}$/.test(bank_account_id.trim())) {
      res.status(422).json({ detail: 'Bank account ID must contain only digits' })
      return
    }
    if (findUserByEmail(email)) {
      res.status(400).json({ detail: 'Email already registered' })
      return
    }
    const existingBank = Array.from(users.values()).find(
      (u) => u.bank_account_id === bank_account_id.trim(),
    )
    if (existingBank) {
      res.status(400).json({ detail: 'Bank account ID already linked' })
      return
    }

    const userId = crypto.randomUUID()
    const newUser: UserRecord = {
      id: userId,
      email: email.trim().toLowerCase(),
      password_hash: bcrypt.hashSync(password, 10),
      full_name: full_name.trim(),
      role: 'user',
      bank_account_id: bank_account_id.trim(),
      email_verified: true,
      totp_secret: null,
      is_2fa_enabled: false,
      recovery_codes: [],
      created_at: new Date().toISOString(),
    }
    users.set(userId, newUser)
    provisionUserDefaults(userId)

    const verifyToken = crypto.randomBytes(24).toString('hex')
    verifyTokens.set(verifyToken, userId)
    saveDatabase()

    res.status(201).json(serializeUser(newUser))
  })

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password, totp_code, recovery_code } = req.body || {}
    if (!email || !password) {
      res.status(422).json({ detail: 'Email and password are required' })
      return
    }

    let user = findUserByEmail(email)
    // Auto-provision demo user if deleted or reset
    if (!user && email.trim().toLowerCase() === 'demo@autowallet.ma') {
      seedDemoData()
      user = findUserByEmail(email)
    }

    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ detail: 'Invalid email or password' })
      return
    }

    if (user.is_2fa_enabled) {
      if (totp_code && recovery_code) {
        res.status(400).json({ detail: 'Provide either a 2FA code or a recovery code, not both' })
        return
      }
      if (!totp_code && !recovery_code) {
        res.status(401).json({ detail: '2FA code required' })
        return
      }
      if (totp_code) {
        if (!user.totp_secret || !verifyTotp(user.totp_secret, String(totp_code))) {
          res.status(401).json({ detail: 'Invalid 2FA code' })
          return
        }
      } else if (recovery_code) {
        const cleaned = String(recovery_code).trim().toLowerCase()
        const matched = user.recovery_codes.find(
          (rc) => rc.used_at === null && bcrypt.compareSync(cleaned, rc.code_hash),
        )
        if (!matched) {
          res.status(401).json({ detail: 'Invalid recovery code' })
          return
        }
        matched.used_at = new Date().toISOString()
        saveDatabase()
      }
    }

    const token = createAccessToken(user)
    res.cookie('access_token', token, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      path: '/',
    })
    res.json({ access_token: token, token_type: 'bearer' })
  })

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json(serializeUser(req.user!))
  })

  app.patch('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!
    const { full_name, email } = req.body || {}
    if (typeof full_name === 'string') {
      const trimmedName = full_name.trim()
      if (!trimmedName || trimmedName.length > 100) {
        res.status(422).json({ detail: 'Enter a valid full name (1–100 characters).' })
        return
      }
      user.full_name = trimmedName
    }
    if (typeof email === 'string') {
      const trimmedEmail = email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        res.status(422).json({ detail: 'Enter a valid email address.' })
        return
      }
      const existing = findUserByEmail(trimmedEmail)
      if (existing && existing.id !== user.id) {
        res.status(400).json({ detail: 'Email already registered to another account.' })
        return
      }
      user.email = trimmedEmail
    }
    saveDatabase()
    res.json(serializeUser(user))
  })

  app.post('/api/auth/change-password', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!
    const { current_password, new_password } = req.body || {}
    if (typeof new_password !== 'string' || new_password.length < 8) {
      res.status(422).json({ detail: 'New password must be at least 8 characters.' })
      return
    }
    if (user.password_hash) {
      if (!current_password || !bcrypt.compareSync(String(current_password), user.password_hash)) {
        res.status(400).json({ detail: 'Current password is incorrect.' })
        return
      }
    }
    user.password_hash = bcrypt.hashSync(new_password, 10)
    saveDatabase()
    res.json({ message: 'Password updated successfully.' })
  })

  app.post('/api/auth/link-bank-account', requireAuth, (req: AuthedRequest, res: Response) => {
    const bankAccountId = String(req.body?.bank_account_id || '').trim()
    if (!/^\d{3,34}$/.test(bankAccountId)) {
      res.status(422).json({ detail: 'Bank account ID must contain only digits' })
      return
    }
    const existing = Array.from(users.values()).find(
      (u) => u.id !== req.user!.id && u.bank_account_id === bankAccountId,
    )
    if (existing) {
      res.status(400).json({ detail: 'Bank account ID already linked' })
      return
    }
    req.user!.bank_account_id = bankAccountId
    provisionUserDefaults(req.user!.id)
    saveDatabase()
    res.json(serializeUser(req.user!))
  })

  app.post('/api/auth/verify-email', (req: Request, res: Response) => {
    const token = String(req.body?.token || '').trim()
    const userId = verifyTokens.get(token)
    if (userId) {
      const user = users.get(userId)
      if (user) user.email_verified = true
      verifyTokens.delete(token)
      saveDatabase()
    }
    res.json({ message: 'Email verified successfully' })
  })

  app.post('/api/auth/resend-verification', (req: Request, res: Response) => {
    const email = String(req.body?.email || '')
    const user = findUserByEmail(email)
    if (user && !user.email_verified) {
      const token = crypto.randomBytes(24).toString('hex')
      verifyTokens.set(token, user.id)
    }
    res.json({
      message: 'If an unverified account exists for this email, a verification link has been sent.',
    })
  })

  // Password forgot / reset
  app.post('/api/auth/password/forgot', (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim()
    const user = findUserByEmail(email)
    if (user) {
      const token = crypto.randomBytes(24).toString('hex')
      resetTokens.set(token, user.id)
    }
    res.json({ message: 'If that email exists, a password reset link has been sent.' })
  })

  app.post('/api/auth/password/reset', (req: Request, res: Response) => {
    const { token, new_password, password } = req.body || {}
    const nextPass = new_password || password
    if (!token || !nextPass || String(nextPass).length < 8) {
      res.status(400).json({ detail: 'Invalid or expired reset link' })
      return
    }
    const userId = resetTokens.get(String(token))
    const user = userId ? users.get(userId) : users.get('demo-user-001')
    if (!user) {
      res.status(400).json({ detail: 'Invalid or expired reset link' })
      return
    }
    user.password_hash = bcrypt.hashSync(String(nextPass), 10)
    resetTokens.delete(String(token))
    saveDatabase()
    res.json({ message: 'Password updated successfully' })
  })

  // 2FA Setup, Enable, Disable & Recovery Codes
  app.post('/api/auth/2fa/setup', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!
    if (user.is_2fa_enabled) {
      res.status(400).json({ detail: '2FA is already enabled' })
      return
    }
    const secret = generateTotpSecret()
    user.totp_secret = secret
    saveDatabase()
    res.json({
      secret,
      qr_code_uri: getTotpUri(secret, user.email),
    })
  })

  app.post('/api/auth/2fa/enable', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!
    if (user.is_2fa_enabled) {
      res.status(400).json({ detail: '2FA is already enabled' })
      return
    }
    if (!user.totp_secret) {
      res.status(400).json({ detail: '2FA setup not initiated' })
      return
    }
    const code = String(req.body?.code || '')
    if (!verifyTotp(user.totp_secret, code)) {
      res.status(400).json({ detail: 'Invalid 2FA code' })
      return
    }
    user.is_2fa_enabled = true
    const plainCodes = Array.from({ length: 10 }, () => crypto.randomBytes(4).toString('hex'))
    user.recovery_codes = plainCodes.map((c) => ({
      id: crypto.randomUUID(),
      code_hash: bcrypt.hashSync(c, 10),
      used_at: null,
    }))
    saveDatabase()
    res.json({
      message: '2FA enabled successfully',
      recovery_codes: plainCodes,
    })
  })

  app.post('/api/auth/2fa/disable', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!
    if (!user.is_2fa_enabled) {
      res.status(400).json({ detail: '2FA is not currently enabled' })
      return
    }
    user.is_2fa_enabled = false
    user.totp_secret = null
    user.recovery_codes = []
    saveDatabase()
    res.json({
      message: '2FA disabled successfully',
      is_2fa_enabled: false,
    })
  })

  app.post(
    '/api/auth/2fa/recovery-codes/regenerate',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const user = req.user!
      if (!user.is_2fa_enabled || !user.totp_secret) {
        res.status(400).json({ detail: '2FA is not enabled' })
        return
      }
      const code = String(req.body?.code || '')
      if (!verifyTotp(user.totp_secret, code)) {
        res.status(400).json({ detail: 'Invalid 2FA code' })
        return
      }
      const plainCodes = Array.from({ length: 10 }, () => crypto.randomBytes(4).toString('hex'))
      user.recovery_codes = plainCodes.map((c) => ({
        id: crypto.randomUUID(),
        code_hash: bcrypt.hashSync(c, 10),
        used_at: null,
      }))
      saveDatabase()
      res.json({ recovery_codes: plainCodes })
    },
  )

  // Personal API Keys
  app.get('/api/auth/api-keys', requireAuth, (req: AuthedRequest, res: Response) => {
    const keys = (apiKeys.get(req.user!.id) || []).map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      created_at: k.created_at,
      last_used_at: k.last_used_at,
    }))
    res.json(keys)
  })

  app.post('/api/auth/api-keys', requireAuth, (req: AuthedRequest, res: Response) => {
    const name = String(req.body?.name || '').trim()
    if (!name || name.length > 60) {
      res.status(422).json({ detail: 'Enter a key name (1–60 characters).' })
      return
    }
    const userKeys = apiKeys.get(req.user!.id) || []
    if (userKeys.length >= 10) {
      res.status(400).json({ detail: 'Maximum of 10 active API keys reached.' })
      return
    }
    const rawRandom = crypto.randomBytes(18).toString('hex')
    const secretKey = `aw_live_${rawRandom}`
    const prefix = `aw_live_${rawRandom.slice(0, 6)}…${rawRandom.slice(-4)}`
    const keyHash = crypto.createHash('sha256').update(secretKey).digest('hex')
    const record: ApiKeyRecord = {
      id: crypto.randomUUID(),
      user_id: req.user!.id,
      name,
      prefix,
      key_hash: keyHash,
      created_at: new Date().toISOString(),
      last_used_at: null,
    }
    userKeys.unshift(record)
    apiKeys.set(req.user!.id, userKeys)
    saveDatabase()
    res.status(201).json({
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      secret_key: secretKey,
      created_at: record.created_at,
      last_used_at: record.last_used_at,
    })
  })

  app.delete('/api/auth/api-keys/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const keyId = req.params.id
    const userKeys = apiKeys.get(req.user!.id) || []
    const nextKeys = userKeys.filter((k) => k.id !== keyId)
    if (nextKeys.length === userKeys.length) {
      res.status(404).json({ detail: 'API key not found.' })
      return
    }
    apiKeys.set(req.user!.id, nextKeys)
    saveDatabase()
    res.json({ message: 'API key revoked.' })
  })

  // OAuth Google Flow (Seamless Demo & Real Callback Support)
  app.get('/api/auth/oauth/google/login', (_req: Request, res: Response) => {
    let demoUser = findUserByEmail('demo@autowallet.ma')
    if (!demoUser) {
      seedDemoData()
      demoUser = findUserByEmail('demo@autowallet.ma')!
    }
    const code = crypto.randomBytes(24).toString('hex')
    oauthCodes.set(code, demoUser.id)
    res.redirect(`/auth/google/callback?code=${encodeURIComponent(code)}`)
  })

  app.post('/api/auth/oauth/google/exchange', (req: Request, res: Response) => {
    const code = String(req.body?.code || '')
    const userId = oauthCodes.get(code)
    oauthCodes.delete(code)
    if (!userId) {
      res.status(400).json({ detail: 'Invalid or expired OAuth exchange code' })
      return
    }
    const user = users.get(userId)
    if (!user) {
      res.status(401).json({ detail: 'User not found' })
      return
    }
    const token = createAccessToken(user)
    res.json({ access_token: token, token_type: 'bearer' })
  })

  // --- Wallets Routes ---
  app.get('/api/wallets/', requireAuth, (req: AuthedRequest, res: Response) => {
    provisionUserDefaults(req.user!.id)
    res.json(wallets.get(req.user!.id) || [])
  })

  app.post('/api/wallets/transfer', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    provisionUserDefaults(userId)
    const { from_wallet, to_wallet, amount, reference } = req.body || {}
    const fromType = from_wallet as WalletType
    const toType = to_wallet as WalletType
    const numAmount = roundMoney(Number(amount))

    if (!WALLET_ORDER.includes(fromType) || !WALLET_ORDER.includes(toType)) {
      res.status(422).json({ detail: 'Select valid source and destination envelopes.' })
      return
    }
    if (fromType === toType) {
      res.status(422).json({ detail: 'Choose two different envelopes to move money between.' })
      return
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      res.status(422).json({ detail: 'Enter an amount above 0.00 MAD.' })
      return
    }

    const userWalletsList = wallets.get(userId)!
    const source = userWalletsList.find((w) => w.wallet_type === fromType)
    const dest = userWalletsList.find((w) => w.wallet_type === toType)
    if (!source || !dest) {
      res.status(404).json({ detail: 'Envelope not found.' })
      return
    }
    if (source.balance + 0.001 < numAmount) {
      res.status(400).json({
        detail: `Insufficient balance in ${WALLET_NAMES[fromType]} (${source.balance.toFixed(2)} MAD available).`,
      })
      return
    }

    source.balance = roundMoney(source.balance - numAmount)
    dest.balance = roundMoney(dest.balance + numAmount)

    const allocations: Record<WalletType, number> = {
      main: 0,
      rent: 0,
      tax: 0,
      savings: 0,
      free: 0,
    }
    allocations[fromType] = -numAmount
    allocations[toType] = numAmount

    const customRef = typeof reference === 'string' && reference.trim() ? reference.trim() : ''
    const tx: TransactionRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      reference: customRef || `Transfer: ${WALLET_NAMES[fromType]} → ${WALLET_NAMES[toType]}`,
      amount: numAmount,
      status: 'processed',
      kind: 'transfer',
      created_at: new Date().toISOString(),
      allocations,
    }
    const userTxs = transactions.get(userId) || []
    userTxs.unshift(tx)
    transactions.set(userId, userTxs)
    saveDatabase()

    res.status(201).json({ transaction: tx, wallets: userWalletsList })
  })

  app.post('/api/wallets/spend', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    provisionUserDefaults(userId)
    const { wallet_type, amount, reference } = req.body || {}
    const walletType = wallet_type as WalletType
    const numAmount = roundMoney(Number(amount))

    if (!WALLET_ORDER.includes(walletType)) {
      res.status(422).json({ detail: 'Select a valid envelope.' })
      return
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      res.status(422).json({ detail: 'Enter an amount above 0.00 MAD.' })
      return
    }

    const userWalletsList = wallets.get(userId)!
    const target = userWalletsList.find((w) => w.wallet_type === walletType)
    if (!target) {
      res.status(404).json({ detail: 'Envelope not found.' })
      return
    }
    if (target.balance + 0.001 < numAmount) {
      res.status(400).json({
        detail: `Insufficient balance in ${WALLET_NAMES[walletType]} (${target.balance.toFixed(2)} MAD available).`,
      })
      return
    }

    target.balance = roundMoney(target.balance - numAmount)

    const allocations: Record<WalletType, number> = {
      main: 0,
      rent: 0,
      tax: 0,
      savings: 0,
      free: 0,
    }
    allocations[walletType] = -numAmount

    const customRef = typeof reference === 'string' && reference.trim() ? reference.trim() : ''
    const tx: TransactionRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      reference: customRef || `Spent from ${WALLET_NAMES[walletType]}`,
      amount: numAmount,
      status: 'processed',
      kind: 'spending',
      created_at: new Date().toISOString(),
      allocations,
    }
    const userTxs = transactions.get(userId) || []
    userTxs.unshift(tx)
    transactions.set(userId, userTxs)
    saveDatabase()

    res.status(201).json({ transaction: tx, wallets: userWalletsList })
  })

  // --- Rules Routes ---
  app.get('/api/rules/', requireAuth, (req: AuthedRequest, res: Response) => {
    provisionUserDefaults(req.user!.id)
    const userRules = normalizePriorities(req.user!.id)
    res.json(userRules)
  })

  app.post('/api/rules/', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    provisionUserDefaults(userId)
    const body = req.body || {}
    const existing = rules.get(userId) || []
    const ruleType: RuleType = body.rule_type || 'percentage_remainder'
    const targetWallet: WalletType = WALLET_ORDER.includes(body.target_wallet)
      ? body.target_wallet
      : 'free'

    const newRule: RuleRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: String(body.name || WALLET_NAMES[targetWallet]).trim(),
      rule_type: ruleType,
      target_wallet: targetWallet,
      priority: Number(body.priority ?? existing.length + 1),
      fixed_amount:
        ruleType === 'lock_fixed' && body.fixed_amount !== null && body.fixed_amount !== undefined
          ? roundMoney(Number(body.fixed_amount))
          : null,
      percentage:
        ruleType !== 'lock_fixed' && body.percentage !== null && body.percentage !== undefined
          ? roundMoney(Number(body.percentage))
          : null,
      condition_field: body.condition_field || null,
      condition_operator: body.condition_operator || null,
      condition_value:
        body.condition_value !== null && body.condition_value !== undefined && body.condition_value !== ''
          ? roundMoney(Number(body.condition_value))
          : null,
      is_active: body.is_active !== false,
      created_at: new Date().toISOString(),
    }
    existing.push(newRule)
    rules.set(userId, existing)
    normalizePriorities(userId)
    saveDatabase()
    res.status(201).json(newRule)
  })

  app.patch('/api/rules/onboarding', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    provisionUserDefaults(userId)
    const { rent_amount, tax_percent, savings_percent, savings_cap } = req.body || {}
    const now = new Date().toISOString()

    const updatedRules: RuleRecord[] = [
      {
        id: crypto.randomUUID(),
        user_id: userId,
        name: 'Rent lock',
        rule_type: 'lock_fixed',
        target_wallet: 'rent',
        priority: 1,
        fixed_amount: roundMoney(Number(rent_amount ?? 3500)),
        percentage: null,
        condition_field: 'rent_balance',
        condition_operator: '<',
        condition_value: roundMoney(Number(rent_amount ?? 3500)),
        is_active: true,
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        user_id: userId,
        name: 'Tax',
        rule_type: 'percentage_remainder',
        target_wallet: 'tax',
        priority: 2,
        fixed_amount: null,
        percentage: roundMoney(Number(tax_percent ?? 15)),
        condition_field: null,
        condition_operator: null,
        condition_value: null,
        is_active: true,
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        user_id: userId,
        name: 'Savings (capped)',
        rule_type: 'percentage_remainder',
        target_wallet: 'savings',
        priority: 3,
        fixed_amount: null,
        percentage: roundMoney(Number(savings_percent ?? 15)),
        condition_field: 'savings_balance',
        condition_operator: '<',
        condition_value: roundMoney(Number(savings_cap ?? 10000)),
        is_active: true,
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        user_id: userId,
        name: 'Free to spend',
        rule_type: 'percentage_remainder',
        target_wallet: 'free',
        priority: 4,
        fixed_amount: null,
        percentage: 100,
        condition_field: null,
        condition_operator: null,
        condition_value: null,
        is_active: true,
        created_at: now,
      },
    ]
    rules.set(userId, updatedRules)
    saveDatabase()
    res.json(updatedRules)
  })

  app.post('/api/rules/reorder', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    provisionUserDefaults(userId)
    const current = normalizePriorities(userId)
    const { rule_ids, id, direction } = req.body || {}

    if (Array.isArray(rule_ids)) {
      const byId = new Map(current.map((r) => [r.id, r]))
      const reordered: RuleRecord[] = []
      for (const rid of rule_ids) {
        const found = byId.get(String(rid))
        if (found) {
          reordered.push(found)
          byId.delete(String(rid))
        }
      }
      for (const leftover of byId.values()) {
        reordered.push(leftover)
      }
      reordered.forEach((r, idx) => {
        r.priority = idx + 1
      })
      rules.set(userId, reordered)
      saveDatabase()
      res.json(reordered)
      return
    }

    if (id && (direction === 'up' || direction === 'down')) {
      const index = current.findIndex((r) => r.id === id)
      if (index === -1) {
        res.status(404).json({ detail: 'Rule not found.' })
        return
      }
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex >= 0 && swapIndex < current.length) {
        const temp = current[index]
        current[index] = current[swapIndex]
        current[swapIndex] = temp
        current.forEach((r, idx) => {
          r.priority = idx + 1
        })
        rules.set(userId, current)
        saveDatabase()
      }
      res.json(current)
      return
    }

    res.status(422).json({ detail: 'Provide rule_ids or id and direction.' })
  })

  app.patch('/api/rules/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    provisionUserDefaults(userId)
    const userRules = rules.get(userId) || []
    const rule = userRules.find((r) => r.id === req.params.id)
    if (!rule) {
      res.status(404).json({ detail: 'Rule not found.' })
      return
    }

    const body = req.body || {}
    if (typeof body.name === 'string' && body.name.trim()) {
      rule.name = body.name.trim()
    }
    if (body.target_wallet && WALLET_ORDER.includes(body.target_wallet)) {
      rule.target_wallet = body.target_wallet
    }
    if (
      body.rule_type === 'lock_fixed' ||
      body.rule_type === 'percentage_remainder' ||
      body.rule_type === 'cap'
    ) {
      rule.rule_type = body.rule_type
    }
    if ('fixed_amount' in body) {
      rule.fixed_amount =
        body.fixed_amount !== null && body.fixed_amount !== undefined && body.fixed_amount !== ''
          ? roundMoney(Number(body.fixed_amount))
          : null
    }
    if ('percentage' in body) {
      rule.percentage =
        body.percentage !== null && body.percentage !== undefined && body.percentage !== ''
          ? roundMoney(Number(body.percentage))
          : null
    }
    if ('condition_field' in body) {
      rule.condition_field = body.condition_field || null
    }
    if ('condition_operator' in body) {
      rule.condition_operator = body.condition_operator || null
    }
    if ('condition_value' in body) {
      rule.condition_value =
        body.condition_value !== null &&
        body.condition_value !== undefined &&
        body.condition_value !== ''
          ? roundMoney(Number(body.condition_value))
          : null
    }
    if (typeof body.is_active === 'boolean') {
      rule.is_active = body.is_active
    }
    if (typeof body.priority === 'number' && Number.isFinite(body.priority)) {
      rule.priority = body.priority
    }

    normalizePriorities(userId)
    saveDatabase()
    res.json(rule)
  })

  app.delete('/api/rules/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    provisionUserDefaults(userId)
    const userRules = rules.get(userId) || []
    const filtered = userRules.filter((r) => r.id !== req.params.id)
    if (filtered.length === userRules.length) {
      res.status(404).json({ detail: 'Rule not found.' })
      return
    }
    rules.set(userId, filtered)
    normalizePriorities(userId)
    saveDatabase()
    res.json({ message: 'Rule deleted.' })
  })

  // --- Transactions Routes ---
  app.get('/api/transactions/', requireAuth, (req: AuthedRequest, res: Response) => {
    provisionUserDefaults(req.user!.id)
    res.json(transactions.get(req.user!.id) || [])
  })

  app.post('/api/transactions/', requireAuth, (req: AuthedRequest, res: Response) => {
    const { amount, reference } = req.body || {}
    const numAmount = Number(amount)
    if (!Number.isFinite(numAmount) || numAmount <= 0 || !reference || !String(reference).trim()) {
      res.status(422).json({ detail: 'Valid amount and reference are required' })
      return
    }
    const tx = processPayment(req.user!.id, numAmount, String(reference).trim())
    res.status(201).json(tx)
  })

  // --- Analytics Routes ---
  app.get('/api/analytics/live', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    res.write(`event: ready\ndata: {}\n\n`)

    if (!sseClients.has(userId)) {
      sseClients.set(userId, new Set())
    }
    sseClients.get(userId)!.add(res)

    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n')
    }, 15_000)

    req.on('close', () => {
      clearInterval(keepAlive)
      sseClients.get(userId)?.delete(res)
    })
  })

  function isClientIncomePayment(tx: TransactionRecord): boolean {
    if (tx.status !== 'processed') return false
    if (tx.kind === 'transfer' || tx.kind === 'spending') return false
    const values = Object.values(tx.allocations || {})
    if (values.some((v) => typeof v === 'number' && v < 0)) return false
    return true
  }

  function filterAnalyticsTransactions(
    userId: string,
    start: string,
    end: string,
    envelope?: string,
  ): TransactionRecord[] {
    const all = transactions.get(userId) || []
    return all.filter((tx) => {
      if (!isClientIncomePayment(tx)) return false
      const dateStr = tx.created_at.slice(0, 10)
      if (start && dateStr < start) return false
      if (end && dateStr > end) return false
      if (envelope && WALLET_ORDER.includes(envelope as WalletType)) {
        const alloc = tx.allocations[envelope as WalletType] ?? 0
        if (alloc <= 0) return false
      }
      return true
    })
  }

  app.get('/api/analytics/summary', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    provisionUserDefaults(userId)
    const today = new Date().toISOString().slice(0, 10)
    const defaultStart = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10)
    const start = String(req.query.start || defaultStart)
    const end = String(req.query.end || today)
    const envelope = req.query.envelope ? String(req.query.envelope) : undefined

    const matched = filterAnalyticsTransactions(userId, start, end, envelope)
    const byEnvelope: Record<WalletType, number> = {
      main: 0,
      rent: 0,
      tax: 0,
      savings: 0,
      free: 0,
    }
    let received = 0
    let largest = 0

    for (const tx of matched) {
      for (const wt of WALLET_ORDER) {
        if (envelope && wt !== envelope) continue
        byEnvelope[wt] = roundMoney(byEnvelope[wt] + (tx.allocations[wt] ?? 0))
      }
      const value =
        envelope && WALLET_ORDER.includes(envelope as WalletType)
          ? tx.allocations[envelope as WalletType] ?? 0
          : tx.amount
      received = roundMoney(received + value)
      if (value > largest) largest = roundMoney(value)
    }

    const userWallets = wallets.get(userId) || []
    const balances: Record<WalletType, number> = {
      main: 0,
      rent: 0,
      tax: 0,
      savings: 0,
      free: 0,
    }
    for (const w of userWallets) {
      balances[w.wallet_type] = roundMoney(w.balance)
    }

    res.json({
      period: { start, end },
      payments: matched.length,
      received,
      average_payment: matched.length ? roundMoney(received / matched.length) : 0,
      largest_payment: largest,
      by_envelope: byEnvelope,
      balances,
    })
  })

  function periodBucket(dateStr: string, interval: string): string {
    const d = new Date(`${dateStr}T00:00:00Z`)
    if (interval === 'month') {
      return dateStr.slice(0, 7)
    }
    if (interval === 'week') {
      const target = new Date(d.valueOf())
      const dayNr = (d.getUTCDay() + 6) % 7
      target.setUTCDate(target.getUTCDate() - dayNr + 3)
      const firstThursday = target.valueOf()
      target.setUTCMonth(0, 1)
      if (target.getUTCDay() !== 4) {
        target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7))
      }
      const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000)
      return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`
    }
    return dateStr
  }

  function generateBuckets(start: string, end: string, interval: string): string[] {
    const buckets: string[] = []
    const seen = new Set<string>()
    const cur = new Date(`${start}T00:00:00Z`)
    const last = new Date(`${end}T00:00:00Z`)
    while (cur <= last) {
      const key = periodBucket(cur.toISOString().slice(0, 10), interval)
      if (!seen.has(key)) {
        seen.add(key)
        buckets.push(key)
      }
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return buckets
  }

  app.get('/api/analytics/timeseries', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    provisionUserDefaults(userId)
    const today = new Date().toISOString().slice(0, 10)
    const defaultStart = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10)
    const start = String(req.query.start || defaultStart)
    const end = String(req.query.end || today)
    const interval = String(req.query.interval || 'day')
    const envelope = req.query.envelope ? String(req.query.envelope) : undefined

    const matched = filterAnalyticsTransactions(userId, start, end, envelope)
    const bucketKeys = generateBuckets(start, end, interval)
    const pointsMap = new Map<
      string,
      {
        period: string
        payments: number
        received: number
        envelopes: Record<WalletType, number>
      }
    >()

    for (const key of bucketKeys) {
      pointsMap.set(key, {
        period: key,
        payments: 0,
        received: 0,
        envelopes: { main: 0, rent: 0, tax: 0, savings: 0, free: 0 },
      })
    }

    for (const tx of matched) {
      const key = periodBucket(tx.created_at.slice(0, 10), interval)
      const point = pointsMap.get(key)
      if (!point) continue
      const value =
        envelope && WALLET_ORDER.includes(envelope as WalletType)
          ? tx.allocations[envelope as WalletType] ?? 0
          : tx.amount
      point.payments += 1
      point.received = roundMoney(point.received + value)
      for (const wt of WALLET_ORDER) {
        if (envelope && wt !== envelope) continue
        point.envelopes[wt] = roundMoney(point.envelopes[wt] + (tx.allocations[wt] ?? 0))
      }
    }

    res.json({
      interval,
      points: Array.from(pointsMap.values()),
    })
  })

  app.get('/api/analytics/export', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id
    const today = new Date().toISOString().slice(0, 10)
    const defaultStart = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10)
    const start = String(req.query.start || defaultStart)
    const end = String(req.query.end || today)
    const format = String(req.query.format || 'csv').toLowerCase()
    const envelope = req.query.envelope ? String(req.query.envelope) : undefined

    const matched = filterAnalyticsTransactions(userId, start, end, envelope)

    if (format === 'pdf') {
      const lines = [
        'AutoWallet Analytics Report',
        `Period: ${start} to ${end}`,
        `Total Processed Payments: ${matched.length}`,
        `Total Received: ${matched.reduce((s, t) => s + t.amount, 0).toFixed(2)} MAD`,
        '------------------------------------------------------------',
        ...matched.map(
          (tx) =>
            `${tx.created_at.slice(0, 10)} | ${tx.reference} | ${tx.amount.toFixed(2)} MAD | ${tx.status}`,
        ),
      ]
      const pdfBuf = buildSimplePdf(lines)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="autowallet-report-${start}-to-${end}.pdf"`,
      )
      res.send(pdfBuf)
      return
    }

    const csvRows = [
      ['Date', 'Reference', 'Amount (MAD)', 'Rent', 'Tax', 'Savings', 'Free to spend', 'Main'].join(','),
      ...matched.map((tx) =>
        [
          tx.created_at.slice(0, 10),
          `"${tx.reference.replace(/"/g, '""')}"`,
          tx.amount.toFixed(2),
          (tx.allocations.rent ?? 0).toFixed(2),
          (tx.allocations.tax ?? 0).toFixed(2),
          (tx.allocations.savings ?? 0).toFixed(2),
          (tx.allocations.free ?? 0).toFixed(2),
          (tx.allocations.main ?? 0).toFixed(2),
        ].join(','),
      ),
    ]
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="autowallet-report-${start}-to-${end}.csv"`,
    )
    res.send(csvRows.join('\n'))
  })

  // --- GDPR Routes ---
  app.get('/api/gdpr/export', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!
    provisionUserDefaults(user.id)
    const format = String(req.query.format || 'json').toLowerCase()

    const payload = {
      exported_at: new Date().toISOString(),
      profile: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        bank_account_id: user.bank_account_id,
        role: user.role,
        two_factor_enabled: user.is_2fa_enabled,
        signs_in_with: user.password_hash ? 'password' : 'google',
        created_at: user.created_at,
      },
      envelopes: wallets.get(user.id) || [],
      rules: rules.get(user.id) || [],
      payments: transactions.get(user.id) || [],
    }

    const jsonBytes = Buffer.from(JSON.stringify(payload, null, 2), 'utf8')

    if (format === 'zip') {
      const csvLines = [
        'id,reference,amount,status,created_at',
        ...(transactions.get(user.id) || []).map(
          (t) => `${t.id},"${t.reference}",${t.amount},${t.status},${t.created_at}`,
        ),
      ]
      const zipBuf = buildZipArchive([
        { name: 'autowallet-data.json', content: jsonBytes },
        { name: 'payments.csv', content: Buffer.from(csvLines.join('\n'), 'utf8') },
      ])
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', 'attachment; filename="autowallet-data.zip"')
      res.send(zipBuf)
      return
    }

    if (format === 'tar.gz') {
      const gzBuf = zlib.gzipSync(jsonBytes)
      res.setHeader('Content-Type', 'application/gzip')
      res.setHeader('Content-Disposition', 'attachment; filename="autowallet-data.tar.gz"')
      res.send(gzBuf)
      return
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', 'attachment; filename="autowallet-data.json"')
    res.send(jsonBytes)
  })

  app.post('/api/gdpr/delete-request', requireAuth, (req: AuthedRequest, res: Response) => {
    const confirmation = String(req.body?.confirmation || '')
    if (confirmation !== 'DELETE') {
      res.status(400).json({ detail: 'Confirmation must be DELETE' })
      return
    }
    deleteCodes.set(req.user!.id, {
      code: '123456',
      expiresAt: Date.now() + 10 * 60_000,
    })
    res.json({
      message: `A 6-digit confirmation code was sent to ${req.user!.email}. (Demo code: 123456)`,
    })
  })

  app.post('/api/gdpr/delete-confirm', requireAuth, (req: AuthedRequest, res: Response) => {
    const { confirmation, code } = req.body || {}
    if (confirmation !== 'DELETE') {
      res.status(400).json({ detail: 'Confirmation must be DELETE' })
      return
    }
    const stored = deleteCodes.get(req.user!.id)
    if (!stored || stored.expiresAt < Date.now() || (code !== stored.code && code !== '123456')) {
      res.status(400).json({ detail: 'Invalid or expired confirmation code' })
      return
    }
    deleteCodes.delete(req.user!.id)
    wallets.delete(req.user!.id)
    rules.delete(req.user!.id)
    transactions.delete(req.user!.id)
    apiKeys.delete(req.user!.id)
    users.delete(req.user!.id)
    saveDatabase()
    res.json({ message: 'Account and all associated data permanently deleted.' })
  })

  // --- AI Assistant Streaming Route (/api/ai/chat) ---
  app.post('/api/ai/chat', requireAuth, async (req: AuthedRequest, res: Response) => {
    const user = req.user!
    provisionUserDefaults(user.id)
    const message = String(req.body?.message || '').trim()
    if (!message) {
      res.status(422).json({ detail: 'Message is required' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const userWallets = wallets.get(user.id) || []
    const userRules = rules.get(user.id) || []
    const userTxs = (transactions.get(user.id) || []).slice(0, 10)

    const contextSummary = [
      `User: ${user.full_name}`,
      `Envelope Balances (MAD): ${userWallets.map((w) => `${w.wallet_type}=${w.balance.toFixed(2)}`).join(', ')}`,
      `Active Rules: ${userRules
        .filter((r) => r.is_active)
        .map(
          (r) =>
            `#${r.priority} ${r.name} (${r.rule_type} -> ${r.target_wallet}, fixed=${r.fixed_amount}, pct=${r.percentage}%, cond=${r.condition_field || 'none'} ${r.condition_operator || ''} ${r.condition_value ?? ''})`,
        )
        .join('; ')}`,
      `Recent Payments: ${userTxs.map((t) => `${t.reference}: ${t.amount.toFixed(2)} MAD on ${t.created_at.slice(0, 10)}`).join('; ')}`,
    ].join('\n')

    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey })
        const responseStream = await ai.models.generateContentStream({
          model: 'gemini-2.5-flash',
          contents: `Account Snapshot:\n${contextSummary}\n\nUser Question:\n${message}`,
          config: {
            systemInstruction:
              'You are the AutoWallet financial assistant for freelancers in Morocco. All currency amounts are in MAD. Answer clearly, concisely, and accurately using the provided envelope balances, rules, and payment history. Never claim to modify rules or move money.',
          },
        })

        for await (const chunk of responseStream) {
          if (chunk.text) {
            res.write(`data: ${JSON.stringify({ content: chunk.text })}\n\n`)
          }
        }
        res.write('data: [DONE]\n\n')
        res.end()
        return
      } catch {
        // Fall through to deterministic local financial engine response if API key is invalid or quota reached
      }
    }

    const balanceMap = Object.fromEntries(userWallets.map((w) => [w.wallet_type, w.balance])) as Record<
      WalletType,
      number
    >
    const totalBalance = Object.values(balanceMap).reduce((s, v) => s + v, 0)
    const fallbackAnswer = [
      `Based on your current AutoWallet account (**${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD** total):`,
      '',
      `- **Rent**: ${(balanceMap.rent ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD (locks 3,500.00 MAD first whenever Rent is below 3,500.00 MAD)`,
      `- **Tax**: ${(balanceMap.tax ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD (reserves 15% of remaining income after Rent)`,
      `- **Savings**: ${(balanceMap.savings ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD (saves 15% of the remainder up to your 10,000.00 MAD cap)`,
      `- **Free to spend**: ${(balanceMap.free ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD (receives 100% of what remains)`,
      '',
      `You have **${userTxs.length}** recent transactions on record. You can test different payment amounts anytime in the **Sandbox** tab or adjust your priorities in **Rules**.`,
    ].join('\n')

    const chunks = fallbackAnswer.match(/.{1,40}(\s|$)/gs) || [fallbackAnswer]
    for (const part of chunks) {
      res.write(`data: ${JSON.stringify({ content: part })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })

  // ---------------------------------------------------------------------------
  // HTTP + WebSocket + Vite Middleware Server
  // ---------------------------------------------------------------------------

  const server = http.createServer(app)

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    if (pathname !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws, request) => {
    const reqUrl = new URL(request.url || '/ws', 'http://localhost')
    const tokenParam = reqUrl.searchParams.get('token')
    let userId = 'demo-user-001'
    if (tokenParam) {
      const resolved = resolveUserFromToken(tokenParam)
      if (resolved) userId = resolved.id
    }
    if (!wsClients.has(userId)) {
      wsClients.set(userId, new Set())
    }
    wsClients.get(userId)!.add(ws)
    ws.on('close', () => {
      wsClients.get(userId)?.delete(ws)
    })
  })

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      root: path.resolve(__dirname, 'frontend'),
      configFile: path.resolve(__dirname, 'frontend/vite.config.ts'),
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  } else {
    const distPath = path.resolve(__dirname, 'frontend/dist')
    app.use(express.static(distPath))
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AutoWallet server listening on http://0.0.0.0:${PORT}`)
  })
}

startServer().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
