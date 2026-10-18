export const normalizeRecoveryCode = (value: string) => value.trim().toUpperCase()
export const isRecoveryCode = (value: string) => /^[A-F0-9]{32}$/.test(normalizeRecoveryCode(value))

export function parseRecoveryCodes(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || !('recovery_codes' in payload) ||
      !Array.isArray(payload.recovery_codes) || payload.recovery_codes.length === 0 ||
      !payload.recovery_codes.every((code: unknown) => typeof code === 'string' && isRecoveryCode(code))) {
    throw new Error('Recovery codes could not be read. Generate a new set before relying on backup sign-in.')
  }
  const codes = payload.recovery_codes.map(normalizeRecoveryCode)
  if (new Set(codes).size !== codes.length) throw new Error('The service returned duplicate recovery codes. Generate a new set.')
  return codes
}
