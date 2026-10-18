export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

export const isValidBankAccountId = (value: string) => /^\d{3,50}$/.test(value.trim())
