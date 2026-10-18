import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import zlib from 'zlib'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { GoogleGenAI } from '@google/genai'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.PORT) || 3000
const SECRET_KEY = process.env.SECRET_KEY || 'autowallet-dev-secret-key-2026'

type WalletType = 'main' | 'rent' | 'tax' | 'savings' | 'free'
type RuleType = 'lock_fixed' | 'percentage_remainder'
type TransactionStatus = 'pending' | 'processed' | 'failed'

const ENVELOPES: WalletType[] = ['main', 'rent', 'tax', 'savings', 'free']

interface UserRecord {
  id: string
  full_name: string
  email: string
  hashed_password: string | null
  bank_account_id: string | null
  role: 'client' | 'admin'
  is_active: boolean
  email_verified: boolean
  oauth_provider: string | null
  oauth_id: string | null
  two_factor_enabled: boolean
  two_factor_secret: string | null
  created_at: Date
}

interface WalletRecord {
  id: string
  user_id: string
  wallet_type: WalletType
  balance: number
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
}

interface TransactionRecord {
  id: string
  user_id: string
  reference: string
  amount: number
  status: TransactionStatus
  created_at: Date
  processed_at: Date | null
  allocations: Partial<Record<WalletType, number>>
}

// In-memory data stores
const users = new Map<string, UserRecord>()
const wallets = new Map<string, WalletRecord[]>()
const rules = new Map<string, RuleRecord[]>()
const transactions = new Map<string, TransactionRecord[]>()
const recoveryCodes = new Map<string, Set<string>>() // user_id -> Set of code_hash
const emailVerifyTokens = new Map<string, string>() // token -> user_id
const passwordResetTokens = new Map<string, string>() // token -> user_id
const oauthExchangeCodes = new Map<string, string>() // code -> user_id
const gdprDeleteCodes = new Map<string, { code: string; tries: number; expiresAt: number; lastSentAt: number }>()
const sseClients = new Map<string, Set<Response>>() // user_id -> Set<Response>

// --- Helper functions ---
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function createAccessToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, SECRET_KEY, { expiresIn: '24h' })
}

function verifyAccessToken(token: string): { sub: string; role: string } | null {
  try {
    const decoded = jwt.verify(token, SECRET_KEY) as { sub?: string; role?: string }
    if (decoded && typeof decoded.sub === 'string') {
      return { sub: decoded.sub, role: decoded.role || 'client' }
    }
    return null
  } catch {
    return null
  }
}

// Base32 & RFC 6238 TOTP implementation
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function generateTotpSecret(length = 32): string {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += BASE32_ALPHABET[bytes[i] % 32]
  }
  return out
}

function decodeBase32(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const output: number[] = []
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i])
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

function computeTotp(secret: string, counter: number): string {
  const key = decodeBase32(secret)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter), 0)
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

function verifyTotpCode(secret: string | null, code: string): boolean {
  if (!secret || !/^\d{6}$/.test(code)) return false
  const currentStep = Math.floor(Date.now() / 30000)
  for (let window = -1; window <= 1; window++) {
    if (computeTotp(secret, currentStep + window) === code) {
      return true
    }
  }
  return false
}

function getTotpUri(secret: string, email: string): string {
  const label = encodeURIComponent(`AutoWallet:${email}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=AutoWallet`
}

function hashRecoveryCode(code: string): string {
  return crypto
    .createHmac('sha256', SECRET_KEY)
    .update(code.trim().toUpperCase())
    .digest('hex')
}

function generateRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => crypto.randomBytes(16).toString('hex').toUpperCase())
}

// Provisioning default wallets and rules
function provisionUser(userId: string) {
  const userWallets: WalletRecord[] = ENVELOPES.map((walletType) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    wallet_type: walletType,
    balance: 0,
  }))
  wallets.set(userId, userWallets)

  const userRules: RuleRecord[] = [
    {
      id: crypto.randomUUID(),
      user_id: userId,
      name: 'Rent lock',
      rule_type: 'lock_fixed',
      target_wallet: 'rent',
      priority: 1,
      fixed_amount: 3500.0,
      percentage: null,
      condition_field: 'rent_balance',
      condition_operator: '<',
      condition_value: 3500.0,
      is_active: true,
    },
    {
      id: crypto.randomUUID(),
      user_id: userId,
      name: 'Tax',
      rule_type: 'percentage_remainder',
      target_wallet: 'tax',
      priority: 2,
      fixed_amount: null,
      percentage: 15.0,
      condition_field: null,
      condition_operator: null,
      condition_value: null,
      is_active: true,
    },
    {
      id: crypto.randomUUID(),
      user_id: userId,
      name: 'Savings (capped)',
      rule_type: 'percentage_remainder',
      target_wallet: 'savings',
      priority: 3,
      fixed_amount: null,
      percentage: 15.0,
      condition_field: 'savings_balance',
      condition_operator: '<',
      condition_value: 10000.0,
      is_active: true,
    },
    {
      id: crypto.randomUUID(),
      user_id: userId,
      name: 'Free to spend',
      rule_type: 'percentage_remainder',
      target_wallet: 'free',
      priority: 4,
      fixed_amount: null,
      percentage: 100.0,
      condition_field: null,
      condition_operator: null,
      condition_value: null,
      is_active: true,
    },
  ]
  rules.set(userId, userRules)
  transactions.set(userId, [])
}

// Rule engine port from backend/app/services/rule_engine.py
function conditionMet(rule: RuleRecord, walletBalances: Record<string, number>): boolean {
  if (!rule.condition_field) return true
  const currentValue = walletBalances[rule.condition_field]
  if (currentValue === undefined || rule.condition_value === null) return false
  switch (rule.condition_operator) {
    case '<':
      return currentValue < rule.condition_value
    case '<=':
      return currentValue <= rule.condition_value
    case '>':
      return currentValue > rule.condition_value
    case '>=':
      return currentValue >= rule.condition_value
    case '==':
      return currentValue === rule.condition_value
    default:
      return false
  }
}

function applyRules(
  amount: number,
  userRules: RuleRecord[],
  walletBalances: Record<string, number>
): Partial<Record<WalletType, number>> {
  let pool = amount
  const allocations: Partial<Record<WalletType, number>> = {}
  const activeSorted = [...userRules]
    .filter((r) => r.is_active)
    .sort((a, b) => a.priority - b.priority)

  for (const rule of activeSorted) {
    if (pool <= 0) break
    if (!conditionMet(rule, walletBalances)) continue

    let take = 0
    if (rule.rule_type === 'lock_fixed') {
      take = Math.min(rule.fixed_amount ?? 0, pool)
    } else {
      take = pool * ((rule.percentage ?? 0) / 100)
      const ownBalanceField = `${rule.target_wallet}_balance`
      if (
        rule.condition_field === ownBalanceField &&
        (rule.condition_operator === '<' || rule.condition_operator === '<=') &&
        rule.condition_value !== null
      ) {
        const current = walletBalances[ownBalanceField] ?? 0
        const roomLeft = Math.max(0, rule.condition_value - current)
        take = Math.min(take, roomLeft)
      }
    }
    take = round2(take)
    allocations[rule.target_wallet] = round2((allocations[rule.target_wallet] ?? 0) + take)
    pool = round2(pool - take)
  }

  if (pool > 0) {
    allocations.main = round2((allocations.main ?? 0) + pool)
  }
  return allocations
}

function recordPaymentForUser(
  user: UserRecord,
  reference: string,
  amount: number,
  createdAt: Date = new Date()
): TransactionRecord | null {
  const userTxs = transactions.get(user.id) ?? []
  if (userTxs.some((t) => t.reference === reference)) {
    return null
  }
  const userWallets = wallets.get(user.id) ?? []
  const walletBalances: Record<string, number> = {}
  const walletsByType = new Map<WalletType, WalletRecord>()
  for (const w of userWallets) {
    walletBalances[`${w.wallet_type}_balance`] = w.balance
    walletsByType.set(w.wallet_type, w)
  }

  const userRules = rules.get(user.id) ?? []
  const allocations = applyRules(amount, userRules, walletBalances)

  for (const [walletType, take] of Object.entries(allocations) as [WalletType, number][]) {
    const w = walletsByType.get(walletType)
    if (w && take) {
      w.balance = round2(w.balance + take)
    }
  }

  const tx: TransactionRecord = {
    id: crypto.randomUUID(),
    user_id: user.id,
    reference,
    amount: round2(amount),
    status: 'processed',
    created_at: createdAt,
    processed_at: createdAt,
    allocations,
  }
  userTxs.unshift(tx)
  transactions.set(user.id, userTxs)

  // Publish live SSE event
  const listeners = sseClients.get(user.id)
  if (listeners && listeners.size > 0) {
    const payload = JSON.stringify({
      type: 'payment.processed',
      reference: tx.reference,
      amount: tx.amount,
      allocations: tx.allocations,
    })
    for (const res of listeners) {
      res.write(`event: payment\ndata: ${payload}\n\n`)
    }
  }

  return tx
}

// Seed default demo user so login or Google sign-in has realistic data immediately
function seedInitialData() {
  const demoId = 'usr-demo-autowallet-01'
  const demoUser: UserRecord = {
    id: demoId,
    full_name: 'Yassine El Amrani',
    email: 'demo@autowallet.ma',
    hashed_password: bcrypt.hashSync('DemoPass123!', 10),
    bank_account_id: '2307809114200051',
    role: 'client',
    is_active: true,
    email_verified: true,
    oauth_provider: null,
    oauth_id: null,
    two_factor_enabled: false,
    two_factor_secret: null,
    created_at: new Date(Date.now() - 25 * 86400000),
  }
  users.set(demoId, demoUser)
  provisionUser(demoId)

  const now = Date.now()
  recordPaymentForUser(demoUser, 'INV-2026-041', 12000, new Date(now - 18 * 86400000))
  recordPaymentForUser(demoUser, 'INV-2026-044', 8500, new Date(now - 11 * 86400000))
  recordPaymentForUser(demoUser, 'INV-2026-047', 14200, new Date(now - 4 * 86400000))
}

seedInitialData()

// --- Auth Middleware ---
interface AuthedRequest extends Request {
  user?: UserRecord
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ detail: 'Not authenticated' })
    return
  }
  const token = header.slice(7).trim()
  const payload = verifyAccessToken(token)
  if (!payload) {
    res.status(401).json({ detail: 'Invalid or expired token' })
    return
  }
  const user = users.get(payload.sub)
  if (!user || !user.is_active) {
    res.status(401).json({ detail: 'User not found or inactive' })
    return
  }
  req.user = user
  next()
}

function requireLinkedAccount(req: AuthedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.user?.bank_account_id) {
      res.status(400).json({ detail: 'Bank account not linked' })
      return
    }
    next()
  })
}

// --- Express App Setup ---
const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(cookieParser())
app.use(express.json())

// Health endpoints
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// --- Auth Routes (/api/auth) ---
app.post('/api/auth/register', (req, res) => {
  const { full_name, email, password, bank_account_id } = req.body ?? {}
  if (
    typeof full_name !== 'string' ||
    full_name.trim().length < 2 ||
    typeof email !== 'string' ||
    !email.includes('@') ||
    typeof password !== 'string' ||
    password.length < 8 ||
    typeof bank_account_id !== 'string' ||
    bank_account_id.trim().length < 3
  ) {
    res.status(422).json({ detail: 'Invalid registration details' })
    return
  }

  const normalizedEmail = email.trim().toLowerCase()
  const cleanBank = bank_account_id.trim()

  for (const existing of users.values()) {
    if (existing.email === normalizedEmail) {
      res.status(400).json({ detail: 'An account with this email already exists' })
      return
    }
    if (existing.bank_account_id === cleanBank) {
      res.status(400).json({ detail: 'This bank account is already linked to another user' })
      return
    }
  }

  const id = crypto.randomUUID()
  const newUser: UserRecord = {
    id,
    full_name: full_name.trim(),
    email: normalizedEmail,
    hashed_password: bcrypt.hashSync(password, 10),
    bank_account_id: cleanBank,
    role: 'client',
    is_active: true,
    email_verified: false,
    oauth_provider: null,
    oauth_id: null,
    two_factor_enabled: false,
    two_factor_secret: null,
    created_at: new Date(),
  }

  users.set(id, newUser)
  provisionUser(id)

  res.status(201).json({
    id: newUser.id,
    full_name: newUser.full_name,
    email: newUser.email,
    bank_account_id: newUser.bank_account_id,
  })
})

app.post('/api/auth/login', (req, res) => {
  const { email, password, totp_code, recovery_code } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(401).json({ detail: 'Incorrect email or password' })
    return
  }

  const normalizedEmail = email.trim().toLowerCase()
  const user = Array.from(users.values()).find((u) => u.email === normalizedEmail)
  if (!user || !user.hashed_password || !bcrypt.compareSync(password, user.hashed_password)) {
    res.status(401).json({ detail: 'Incorrect email or password' })
    return
  }

  if (user.two_factor_enabled) {
    if (totp_code && recovery_code) {
      res.status(400).json({ detail: 'Provide only one 2FA method' })
      return
    }
    if (totp_code) {
      if (!verifyTotpCode(user.two_factor_secret, String(totp_code))) {
        res.status(401).json({ detail: 'Invalid 2FA code' })
        return
      }
    } else if (recovery_code) {
      const codeHash = hashRecoveryCode(String(recovery_code))
      const userCodes = recoveryCodes.get(user.id)
      if (!userCodes || !userCodes.has(codeHash)) {
        res.status(401).json({ detail: 'Invalid recovery code' })
        return
      }
      userCodes.delete(codeHash)
    } else {
      res.status(401).json({ detail: '2FA code required' })
      return
    }
  }

  res.json({
    access_token: createAccessToken(user.id, user.role),
    token_type: 'bearer',
  })
})

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!
  res.json({
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    bank_account_id: u.bank_account_id,
  })
})

app.post('/api/auth/link-bank-account', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!
  const { bank_account_id } = req.body ?? {}
  if (typeof bank_account_id !== 'string' || bank_account_id.trim().length < 3) {
    res.status(422).json({ detail: 'Invalid bank account ID' })
    return
  }
  if (user.bank_account_id !== null) {
    res.status(400).json({ detail: 'A bank account is already linked' })
    return
  }
  const cleanId = bank_account_id.trim()
  for (const existing of users.values()) {
    if (existing.bank_account_id === cleanId) {
      res.status(400).json({ detail: 'This bank account is already linked to another user' })
      return
    }
  }
  user.bank_account_id = cleanId
  if (!wallets.has(user.id)) {
    provisionUser(user.id)
  }
  res.json({
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    bank_account_id: user.bank_account_id,
  })
})

app.post('/api/auth/2fa/setup', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!
  if (user.two_factor_enabled) {
    res.status(409).json({ detail: '2FA is already enabled' })
    return
  }
  const secret = generateTotpSecret()
  user.two_factor_secret = secret
  res.json({
    secret,
    provisioning_uri: getTotpUri(secret, user.email),
  })
})

app.post('/api/auth/2fa/verify', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!
  const { code } = req.body ?? {}
  if (user.two_factor_enabled) {
    res.status(409).json({ detail: '2FA is already enabled' })
    return
  }
  if (!user.two_factor_secret) {
    res.status(400).json({ detail: '2FA setup has not been started' })
    return
  }
  if (!verifyTotpCode(user.two_factor_secret, String(code ?? ''))) {
    res.status(400).json({ detail: 'Invalid code' })
    return
  }
  const codes = generateRecoveryCodes()
  recoveryCodes.set(user.id, new Set(codes.map(hashRecoveryCode)))
  user.two_factor_enabled = true
  res.json({
    message: '2FA enabled. Save your recovery codes.',
    recovery_codes: codes,
  })
})

app.post('/api/auth/2fa/recovery-codes/regenerate', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!
  const { password, totp_code } = req.body ?? {}
  if (!user.two_factor_enabled) {
    res.status(400).json({ detail: '2FA is not enabled' })
    return
  }
  if (!user.hashed_password || !bcrypt.compareSync(String(password ?? ''), user.hashed_password)) {
    res.status(401).json({ detail: 'Invalid credentials' })
    return
  }
  if (!verifyTotpCode(user.two_factor_secret, String(totp_code ?? ''))) {
    res.status(401).json({ detail: 'Invalid credentials' })
    return
  }
  const codes = generateRecoveryCodes()
  recoveryCodes.set(user.id, new Set(codes.map(hashRecoveryCode)))
  res.json({
    message: 'Recovery codes regenerated.',
    recovery_codes: codes,
  })
})

app.post('/api/auth/2fa/disable', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!
  const { password, totp_code, recovery_code } = req.body ?? {}
  if (!user.two_factor_enabled) {
    res.status(409).json({ detail: '2FA is not enabled' })
    return
  }
  if (!user.hashed_password || !bcrypt.compareSync(String(password ?? ''), user.hashed_password)) {
    res.status(401).json({ detail: 'Invalid credentials' })
    return
  }
  if (Boolean(totp_code) === Boolean(recovery_code)) {
    res.status(400).json({ detail: 'Provide exactly one 2FA method' })
    return
  }
  if (totp_code) {
    if (!verifyTotpCode(user.two_factor_secret, String(totp_code))) {
      res.status(401).json({ detail: 'Invalid credentials' })
      return
    }
  } else {
    const codeHash = hashRecoveryCode(String(recovery_code))
    const userCodes = recoveryCodes.get(user.id)
    if (!userCodes || !userCodes.has(codeHash)) {
      res.status(401).json({ detail: 'Invalid credentials' })
      return
    }
  }
  recoveryCodes.delete(user.id)
  user.two_factor_enabled = false
  user.two_factor_secret = null
  res.json({ message: 'Two-factor authentication disabled successfully' })
})

app.post('/api/auth/email/resend', (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email === 'string') {
    const user = Array.from(users.values()).find((u) => u.email === email.trim().toLowerCase())
    if (user && !user.email_verified) {
      const token = crypto.randomBytes(24).toString('hex')
      emailVerifyTokens.set(token, user.id)
    }
  }
  res.json({ message: 'If the account needs verification, a verification email will be sent.' })
})

app.post('/api/auth/email/verify', (req, res) => {
  const { token } = req.body ?? {}
  const userId = emailVerifyTokens.get(String(token ?? ''))
  if (!userId) {
    res.status(400).json({ detail: 'Invalid or expired verification token' })
    return
  }
  emailVerifyTokens.delete(String(token))
  const user = users.get(userId)
  if (!user) {
    res.status(400).json({ detail: 'Invalid verification token' })
    return
  }
  user.email_verified = true
  res.json({ message: 'Email verified successfully' })
})

app.post('/api/auth/password/forgot', (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email === 'string') {
    const user = Array.from(users.values()).find((u) => u.email === email.trim().toLowerCase())
    if (user) {
      const token = crypto.randomBytes(24).toString('hex')
      passwordResetTokens.set(token, user.id)
    }
  }
  res.json({ message: 'If an account exists for that email, a password reset link has been sent.' })
})

app.post('/api/auth/password/reset', (req, res) => {
  const { token, password } = req.body ?? {}
  if (typeof password !== 'string' || password.length < 8) {
    res.status(422).json({ detail: 'Password must be at least 8 characters' })
    return
  }
  const userId = passwordResetTokens.get(String(token ?? ''))
  if (!userId) {
    res.status(400).json({ detail: 'Invalid or expired reset token' })
    return
  }
  passwordResetTokens.delete(String(token))
  const user = users.get(userId)
  if (!user) {
    res.status(400).json({ detail: 'User not found' })
    return
  }
  user.hashed_password = bcrypt.hashSync(password, 10)
  res.json({ message: 'Password updated successfully' })
})

// Google OAuth Routes (/api/auth/oauth/google)
app.get('/api/auth/oauth/google/login', (_req, res) => {
  // In preview/dev without external Google OAuth credentials, sign in with the seeded demo account
  const demoUser = users.get('usr-demo-autowallet-01')!
  const exchangeCode = crypto.randomBytes(24).toString('hex')
  oauthExchangeCodes.set(exchangeCode, demoUser.id)
  res.redirect(302, `/auth/google/callback?code=${encodeURIComponent(exchangeCode)}`)
})

app.post('/api/auth/oauth/google/exchange', (req, res) => {
  const { code } = req.body ?? {}
  if (!code || typeof code !== 'string') {
    res.status(400).json({ detail: 'Missing OAuth exchange code' })
    return
  }
  const userId = oauthExchangeCodes.get(code)
  if (!userId) {
    res.status(400).json({ detail: 'Invalid or expired OAuth exchange code' })
    return
  }
  oauthExchangeCodes.delete(code)
  const user = users.get(userId)
  if (!user) {
    res.status(401).json({ detail: 'User not found' })
    return
  }
  res.json({
    access_token: createAccessToken(user.id, user.role),
    token_type: 'bearer',
  })
})

// --- Wallets Routes (/api/wallets) ---
app.get('/api/wallets/', requireLinkedAccount, (req: AuthedRequest, res) => {
  const userWallets = wallets.get(req.user!.id) ?? []
  res.json(
    userWallets.map((w) => ({
      id: w.id,
      wallet_type: w.wallet_type,
      balance: round2(w.balance),
    }))
  )
})

// --- Rules Routes (/api/rules) ---
app.get('/api/rules/', requireLinkedAccount, (req: AuthedRequest, res) => {
  const userRules = [...(rules.get(req.user!.id) ?? [])].sort((a, b) => a.priority - b.priority)
  res.json(userRules)
})

app.patch('/api/rules/onboarding', requireLinkedAccount, (req: AuthedRequest, res) => {
  const { rent_amount, tax_percent, savings_percent, savings_cap } = req.body ?? {}
  if (
    typeof rent_amount !== 'number' ||
    rent_amount < 0 ||
    typeof tax_percent !== 'number' ||
    tax_percent < 0 ||
    tax_percent > 100 ||
    typeof savings_percent !== 'number' ||
    savings_percent < 0 ||
    savings_percent > 100 ||
    typeof savings_cap !== 'number' ||
    savings_cap < 0
  ) {
    res.status(422).json({ detail: 'Invalid onboarding rule values' })
    return
  }

  const userRules = rules.get(req.user!.id) ?? []
  for (const rule of userRules) {
    if (rule.name === 'Rent lock') {
      rule.fixed_amount = round2(rent_amount)
      rule.condition_value = round2(rent_amount)
    } else if (rule.name === 'Tax') {
      rule.percentage = round2(tax_percent)
    } else if (rule.name === 'Savings (capped)') {
      rule.percentage = round2(savings_percent)
      rule.condition_value = round2(savings_cap)
    }
  }
  res.json([...userRules].sort((a, b) => a.priority - b.priority))
})

// --- Transactions Routes (/api/transactions) ---
app.get('/api/transactions/', requireLinkedAccount, (req: AuthedRequest, res) => {
  const userTxs = [...(transactions.get(req.user!.id) ?? [])].sort(
    (a, b) => b.created_at.getTime() - a.created_at.getTime()
  )
  res.json(
    userTxs.map((tx) => ({
      id: tx.id,
      reference: tx.reference,
      amount: tx.amount,
      status: tx.status,
      created_at: tx.created_at.toISOString(),
      allocations: tx.allocations,
    }))
  )
})

app.post('/api/transactions/', requireLinkedAccount, (req: AuthedRequest, res) => {
  const { reference, amount } = req.body ?? {}
  if (typeof reference !== 'string' || !reference.trim() || typeof amount !== 'number' || amount <= 0) {
    res.status(422).json({ detail: 'Enter a valid reference and amount above 0' })
    return
  }
  const tx = recordPaymentForUser(req.user!, reference.trim(), amount)
  if (!tx) {
    res.status(400).json({ detail: 'A transaction with this reference already exists' })
    return
  }
  res.status(201).json({
    id: tx.id,
    reference: tx.reference,
    amount: tx.amount,
    status: tx.status,
    created_at: tx.created_at.toISOString(),
    allocations: tx.allocations,
  })
})

// --- Analytics Helpers & Routes (/api/analytics) ---
function parseDateParam(val: unknown, fallback: string): string {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val
  return fallback
}

function getIsoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function periodKeyForDate(dateStr: string, interval: 'day' | 'week' | 'month'): string {
  if (interval === 'day') return dateStr
  if (interval === 'week') return getIsoWeekKey(dateStr)
  return dateStr.slice(0, 7)
}

function filterPayments(
  userId: string,
  startStr: string,
  endStr: string,
  envelope: WalletType | null
): TransactionRecord[] {
  const startMs = Date.parse(`${startStr}T00:00:00.000Z`)
  const endMs = Date.parse(`${endStr}T23:59:59.999Z`)
  const all = transactions.get(userId) ?? []
  return all
    .filter((tx) => {
      if (tx.status !== 'processed') return false
      const t = tx.created_at.getTime()
      if (t < startMs || t > endMs) return false
      if (envelope && (tx.allocations[envelope] ?? 0) <= 0) return false
      return true
    })
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
}

function computeSummary(userId: string, startStr: string, endStr: string, envelope: WalletType | null) {
  const targetEnvelopes = envelope ? [envelope] : ENVELOPES
  const matched = filterPayments(userId, startStr, endStr, envelope)
  const byEnvelope: Partial<Record<WalletType, number>> = {}
  for (const env of targetEnvelopes) byEnvelope[env] = 0

  for (const tx of matched) {
    for (const env of targetEnvelopes) {
      byEnvelope[env] = round2((byEnvelope[env] ?? 0) + (tx.allocations[env] ?? 0))
    }
  }

  const amounts = matched.map((m) => m.amount)
  const totalReceived = round2(amounts.reduce((a, b) => a + b, 0))
  const userWallets = wallets.get(userId) ?? []
  const balances: Partial<Record<WalletType, number>> = {}
  for (const w of userWallets) {
    if (targetEnvelopes.includes(w.wallet_type)) {
      balances[w.wallet_type] = round2(w.balance)
    }
  }

  return {
    start: startStr,
    end: endStr,
    envelope,
    payments: matched.length,
    received: totalReceived,
    average_payment: matched.length ? round2(totalReceived / matched.length) : 0,
    largest_payment: matched.length ? round2(Math.max(...amounts)) : 0,
    by_envelope: byEnvelope,
    balances,
  }
}

app.get('/api/analytics/summary', requireAuth, (req: AuthedRequest, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const thirtyAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  const startStr = parseDateParam(req.query.start, thirtyAgo)
  const endStr = parseDateParam(req.query.end, today)
  const envParam = typeof req.query.envelope === 'string' && ENVELOPES.includes(req.query.envelope as WalletType)
    ? (req.query.envelope as WalletType)
    : null

  if (startStr > endStr) {
    res.status(422).json({ detail: { code: 'bad_range', message: 'The start date must be before the end date.' } })
    return
  }

  res.json(computeSummary(req.user!.id, startStr, endStr, envParam))
})

app.get('/api/analytics/timeseries', requireAuth, (req: AuthedRequest, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const thirtyAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  const startStr = parseDateParam(req.query.start, thirtyAgo)
  const endStr = parseDateParam(req.query.end, today)
  const interval: 'day' | 'week' | 'month' =
    req.query.interval === 'week' || req.query.interval === 'month' ? req.query.interval : 'day'
  const envParam = typeof req.query.envelope === 'string' && ENVELOPES.includes(req.query.envelope as WalletType)
    ? (req.query.envelope as WalletType)
    : null

  if (startStr > endStr) {
    res.status(422).json({ detail: { code: 'bad_range', message: 'The start date must be before the end date.' } })
    return
  }

  const targetEnvelopes = envParam ? [envParam] : ENVELOPES
  const pointsMap = new Map<string, { period: string; received: number; envelopes: Partial<Record<WalletType, number>> }>()

  let cursor = new Date(`${startStr}T00:00:00.000Z`)
  const endDate = new Date(`${endStr}T00:00:00.000Z`)
  while (cursor <= endDate) {
    const dayIso = cursor.toISOString().slice(0, 10)
    const key = periodKeyForDate(dayIso, interval)
    if (!pointsMap.has(key)) {
      const envInit: Partial<Record<WalletType, number>> = {}
      for (const e of targetEnvelopes) envInit[e] = 0
      pointsMap.set(key, { period: key, received: 0, envelopes: envInit })
    }
    cursor = new Date(cursor.getTime() + 86400000)
  }

  const matched = filterPayments(req.user!.id, startStr, endStr, envParam)
  for (const tx of matched) {
    const dayIso = tx.created_at.toISOString().slice(0, 10)
    const key = periodKeyForDate(dayIso, interval)
    const pt = pointsMap.get(key)
    if (pt) {
      pt.received = round2(pt.received + tx.amount)
      for (const e of targetEnvelopes) {
        pt.envelopes[e] = round2((pt.envelopes[e] ?? 0) + (tx.allocations[e] ?? 0))
      }
    }
  }

  res.json({
    start: startStr,
    end: endStr,
    interval,
    envelope: envParam,
    points: Array.from(pointsMap.values()),
  })
})

function buildSimplePdf(title: string, lines: string[]): Buffer {
  const sanitize = (s: string) => s.replace(/[()\\]/g, '')
  const contentLines = [
    'BT',
    '/F1 14 Tf',
    '50 780 Td',
    `(${sanitize(title)}) Tj`,
    '/F1 10 Tf',
    ...lines.flatMap((line) => ['0 -16 Td', `(${sanitize(line)}) Tj`]),
    'ET',
  ].join('\n')

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(contentLines)} >>\nstream\n${contentLines}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += obj
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'utf-8')
}

app.get('/api/analytics/export', requireAuth, (req: AuthedRequest, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const thirtyAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  const startStr = parseDateParam(req.query.start, thirtyAgo)
  const endStr = parseDateParam(req.query.end, today)
  const format = req.query.format === 'pdf' ? 'pdf' : 'csv'
  const envParam = typeof req.query.envelope === 'string' && ENVELOPES.includes(req.query.envelope as WalletType)
    ? (req.query.envelope as WalletType)
    : null

  const targetEnvelopes = envParam ? [envParam] : ENVELOPES
  const matched = filterPayments(req.user!.id, startStr, endStr, envParam)
  const filename = `autowallet-report-${startStr}-to-${endStr}.${format}`

  if (format === 'pdf') {
    const totals = computeSummary(req.user!.id, startStr, endStr, envParam)
    const lines = [
      `Account: ${req.user!.email} | Period: ${startStr} to ${endStr}`,
      `Payments: ${totals.payments} | Total Received: ${totals.received.toFixed(2)} MAD | Average: ${totals.average_payment.toFixed(2)} MAD`,
      '------------------------------------------------------------------------',
      ...matched.map(
        (p) =>
          `${p.created_at.toISOString().slice(0, 16).replace('T', ' ')} | ${p.reference} | ${p.amount.toFixed(2)} MAD`
      ),
    ]
    const pdfBuf = buildSimplePdf('AutoWallet Report', lines)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(pdfBuf)
    return
  }

  const header = ['date', 'reference', 'amount', ...targetEnvelopes]
  const rows = matched.map((p) => [
    p.created_at.toISOString().slice(0, 16).replace('T', ' '),
    p.reference,
    p.amount.toFixed(2),
    ...targetEnvelopes.map((e) => (p.allocations[e] ?? 0).toFixed(2)),
  ])
  const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(csv)
})

app.get('/api/analytics/live', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  res.write(`event: ready\ndata: {}\n\n`)

  let userClients = sseClients.get(userId)
  if (!userClients) {
    userClients = new Set()
    sseClients.set(userId, userClients)
  }
  userClients.add(res)

  const keepAlive = setInterval(() => {
    res.write(`: keep-alive\n\n`)
  }, 15000)

  req.on('close', () => {
    clearInterval(keepAlive)
    userClients?.delete(res)
  })
})

// --- GDPR Export & Account Deletion (/api/gdpr) ---
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

function createZipArchive(files: { name: string; content: string }[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf-8')
    const dataBuf = Buffer.from(file.content, 'utf-8')
    const compressed = zlib.deflateRawSync(dataBuf)
    const crc = crc32(dataBuf)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(dataBuf.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, nameBuf, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(dataBuf.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(centralHeader, nameBuf)
    offset += localHeader.length + nameBuf.length + compressed.length
  }

  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDir, eocd])
}

app.get('/api/gdpr/export', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!
  const userWallets = wallets.get(user.id) ?? []
  const userRules = [...(rules.get(user.id) ?? [])].sort((a, b) => a.priority - b.priority)
  const userPayments = [...(transactions.get(user.id) ?? [])].sort(
    (a, b) => a.created_at.getTime() - b.created_at.getTime()
  )

  const data = {
    exported_at: new Date().toISOString(),
    profile: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      bank_account_id: user.bank_account_id,
      role: user.role,
      signs_in_with: user.oauth_provider === 'google' ? 'google' : 'email and password',
      two_factor_enabled: Boolean(user.two_factor_enabled),
      created_at: user.created_at.toISOString(),
    },
    envelopes: userWallets.map((w) => ({ type: w.wallet_type, balance: round2(w.balance) })),
    rules: userRules.map((r) => ({
      priority: r.priority,
      name: r.name,
      type: r.rule_type,
      envelope: r.target_wallet,
      fixed_amount: r.fixed_amount,
      percentage: r.percentage,
      condition_field: r.condition_field,
      condition_operator: r.condition_operator,
      condition_value: r.condition_value,
      active: r.is_active,
    })),
    payments: userPayments.map((t) => ({
      reference: t.reference,
      amount: t.amount,
      status: t.status,
      created_at: t.created_at.toISOString(),
      processed_at: t.processed_at ? t.processed_at.toISOString() : null,
    })),
  }

  if (req.query.format === 'csv') {
    const toCsv = (cols: string[], rows: Record<string, unknown>[]) =>
      [cols.join(','), ...rows.map((r) => cols.map((c) => String(r[c] ?? '')).join(','))].join('\n')

    const zipBuf = createZipArchive([
      { name: 'profile.csv', content: toCsv(Object.keys(data.profile), [data.profile]) },
      { name: 'envelopes.csv', content: toCsv(['type', 'balance'], data.envelopes) },
      {
        name: 'rules.csv',
        content: toCsv(
          ['priority', 'name', 'type', 'envelope', 'fixed_amount', 'percentage', 'condition_field', 'condition_operator', 'condition_value', 'active'],
          data.rules
        ),
      },
      {
        name: 'payments.csv',
        content: toCsv(['reference', 'amount', 'status', 'created_at', 'processed_at'], data.payments),
      },
    ])
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="autowallet-my-data.zip"')
    res.send(zipBuf)
    return
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', 'attachment; filename="autowallet-my-data.json"')
  res.send(JSON.stringify(data, null, 2))
})

app.post('/api/gdpr/delete-request', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!
  const existing = gdprDeleteCodes.get(user.id)
  const now = Date.now()
  if (existing && now - existing.lastSentAt < 60000) {
    const wait = Math.ceil((60000 - (now - existing.lastSentAt)) / 1000)
    res.setHeader('Retry-After', String(wait))
    res.status(429).json({
      detail: { code: 'wait', message: `A code was just sent. You can ask for a new one in ${wait} seconds.` },
    })
    return
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  gdprDeleteCodes.set(user.id, {
    code,
    tries: 0,
    expiresAt: now + 15 * 60 * 1000,
    lastSentAt: now,
  })
  res.status(202).json({ message: 'We sent a 6-digit code to your email. It is valid for 15 minutes.' })
})

app.post('/api/gdpr/delete-confirm', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!
  const { code } = req.body ?? {}
  const record = gdprDeleteCodes.get(user.id)
  if (!record || Date.now() > record.expiresAt) {
    res.status(400).json({ detail: { code: 'no_code', message: 'There is no valid code. Ask for a new one.' } })
    return
  }
  record.tries += 1
  if (record.code !== String(code ?? '')) {
    const triesLeft = 5 - record.tries
    if (triesLeft <= 0) {
      gdprDeleteCodes.delete(user.id)
      res.status(429).json({ detail: { code: 'too_many_tries', message: 'Too many wrong codes. Ask for a new one.' } })
      return
    }
    res.status(400).json({
      detail: { code: 'wrong_code', message: `Wrong code. ${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left.` },
    })
    return
  }
  gdprDeleteCodes.delete(user.id)
  users.delete(user.id)
  wallets.delete(user.id)
  rules.delete(user.id)
  transactions.delete(user.id)
  recoveryCodes.delete(user.id)
  res.json({ message: 'Your account and all its data were deleted.' })
})

// --- AI Assistant Routes (/api/ai) ---
const SYSTEM_PROMPT = `You are the AutoWallet assistant, a budgeting helper for freelancers in Morocco.
How AutoWallet works:
- Every payment the user receives is split into 5 envelopes: main, rent, tax, savings, free.
- The user's rules run in priority order (lowest number first) on what is left of the payment.
- A lock_fixed rule takes a fixed amount. A percentage_remainder rule takes a percentage of what is LEFT, not of the whole payment.
- A rule whose condition is false is skipped. Whatever is left at the end goes to main.
- Amounts are in Moroccan dirhams (MAD). AutoWallet is a budgeting ledger: it never moves real money.
How to answer:
- Answer in the same language as the user's question, short and practical.
- If you don't have the facts, say so. Never invent numbers.
- You are not a licensed financial or tax advisor: for tax or legal details, tell the user to check an official source or an accountant.`

function describeUserData(userId: string): string {
  const userWallets = wallets.get(userId) ?? []
  const userRules = [...(rules.get(userId) ?? [])]
    .filter((r) => r.is_active)
    .sort((a, b) => a.priority - b.priority)
  const userPayments = [...(transactions.get(userId) ?? [])]
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, 5)

  const lines = ["The user's current data:", 'Envelopes (balance in MAD):']
  for (const w of userWallets) {
    lines.push(`- ${w.wallet_type}: ${w.balance.toFixed(2)}`)
  }
  lines.push('Rules, in the order they run:')
  for (const r of userRules) {
    const what =
      r.rule_type === 'lock_fixed'
        ? `lock ${(r.fixed_amount ?? 0).toFixed(2)} MAD`
        : `take ${r.percentage ?? 0}% of what is left`
    const cond = r.condition_field
      ? ` (only if ${r.condition_field} ${r.condition_operator} ${r.condition_value})`
      : ''
    lines.push(`${r.priority}. ${r.name} -> ${r.target_wallet}: ${what}${cond}`)
  }
  lines.push('Last payments:')
  if (userPayments.length === 0) {
    lines.push('- none yet')
  } else {
    for (const p of userPayments) {
      lines.push(`- ${p.created_at.toISOString().slice(0, 10)}: ${p.amount.toFixed(2)} MAD (${p.status})`)
    }
  }
  return lines.join('\n')
}

function buildFallbackAssistantReply(question: string, userId: string): string {
  const userWallets = wallets.get(userId) ?? []
  const userRules = [...(rules.get(userId) ?? [])]
    .filter((r) => r.is_active)
    .sort((a, b) => a.priority - b.priority)
  const userPayments = transactions.get(userId) ?? []

  const getBal = (t: WalletType) => (userWallets.find((w) => w.wallet_type === t)?.balance ?? 0).toFixed(2)
  const total = userWallets.reduce((s, w) => s + w.balance, 0).toFixed(2)
  const latest = userPayments[0]

  const lines = [
    `Here is a summary based on your current AutoWallet ledger (${total} MAD total across 5 envelopes):`,
    ``,
    `- **Free to spend**: ${getBal('free')} MAD`,
    `- **Rent**: ${getBal('rent')} MAD`,
    `- **Tax**: ${getBal('tax')} MAD`,
    `- **Savings**: ${getBal('savings')} MAD`,
    `- **Main**: ${getBal('main')} MAD`,
    ``,
    `**How your active rules run (${userRules.length} rules):**`,
    ...userRules.map((r) => {
      const action =
        r.rule_type === 'lock_fixed'
          ? `locks ${(r.fixed_amount ?? 0).toFixed(2)} MAD`
          : `takes ${r.percentage ?? 0}% of the remaining pool`
      const cond = r.condition_field
        ? ` when \`${r.condition_field} ${r.condition_operator} ${r.condition_value}\``
        : ''
      return `${r.priority}. **${r.name}** (${r.target_wallet}): ${action}${cond}`
    }),
  ]

  if (latest) {
    lines.push(
      ``,
      `Your most recent payment was **${latest.reference}** for **${latest.amount.toFixed(2)} MAD** on ${latest.created_at.toISOString().slice(0, 10)}.`
    )
  }
  if (question.toLowerCase().includes('tax')) {
    lines.push(
      ``,
      `*Note: AutoWallet is a budgeting ledger and not a licensed tax advisor. Please consult an official source or an accountant for tax filings.*`
    )
  }
  return lines.join('\n')
}

app.post('/api/ai/chat', requireLinkedAccount, async (req: AuthedRequest, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  if (!message) {
    res.status(422).json({ detail: 'Message is required' })
    return
  }
  const userId = req.user!.id
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY
  if (!apiKey) {
    res.json({ answer: buildFallbackAssistantReply(message, userId) })
    return
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    })
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: message,
      config: {
        systemInstruction: `${SYSTEM_PROMPT}\n\n${describeUserData(userId)}`,
      },
    })
    res.json({ answer: response.text || buildFallbackAssistantReply(message, userId) })
  } catch {
    res.json({ answer: buildFallbackAssistantReply(message, userId) })
  }
})

app.post('/api/ai/chat/stream', requireLinkedAccount, async (req: AuthedRequest, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  if (!message) {
    res.status(422).json({ detail: 'Message is required' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const sendSse = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const userId = req.user!.id
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      })
      const stream = await ai.models.generateContentStream({
        model: 'gemini-3.8-flash',
        contents: message,
        config: {
          systemInstruction: `${SYSTEM_PROMPT}\n\n${describeUserData(userId)}`,
        },
      })
      for await (const chunk of stream) {
        if (chunk.text) {
          sendSse('token', { text: chunk.text })
        }
      }
      sendSse('done', {})
      res.end()
      return
    } catch {
      // Fall through to local ledger assistant stream if API key fails
    }
  }

  const fallback = buildFallbackAssistantReply(message, userId)
  const chunks = fallback.match(/.{1,40}(\s|$)|\S+/g) || [fallback]
  for (const piece of chunks) {
    sendSse('token', { text: piece })
  }
  sendSse('done', {})
  res.end()
})

// --- Start Server with Vite Middleware (Dev) or Static Dist (Prod) ---
async function start() {
  const server = http.createServer(app)

  // WebSocket setup on /ws
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host || 'localhost'}`)
    if (url.pathname !== '/ws') {
      return
    }
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws: WebSocket) => {
    ws.send('WebSocket connection established')
    ws.on('message', (msg) => {
      ws.send(JSON.stringify({ event: 'test.ack', data: { received: msg.toString() } }))
    })
  })

  const frontendRoot = path.resolve(__dirname, 'frontend')
  const distPath = path.resolve(frontendRoot, 'dist')

  if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
    app.use(express.static(distPath))
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  } else {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      root: frontendRoot,
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
      },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AutoWallet server listening on http://0.0.0.0:${PORT}`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
