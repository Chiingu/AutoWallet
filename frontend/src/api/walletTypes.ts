export const walletTypes = ['main', 'rent', 'tax', 'savings', 'free'] as const

export type WalletType = typeof walletTypes[number]

export function isWalletType(value: unknown): value is WalletType {
  return typeof value === 'string' && walletTypes.some(type => type === value)
}
