export interface MemoryLibraryConfig {
  representedPersonName: string
  enabled: boolean
}

export function getMemoryLibraryConfig(): MemoryLibraryConfig {
  return {
    representedPersonName: process.env.REPRESENTED_PERSON_NAME || 'this person',
    enabled: true,
  }
}

export function getPersonName(): string {
  return process.env.REPRESENTED_PERSON_NAME || 'this person'
}

/**
 * The permanent URL encoded in the physical QR code on the kiosk.
 *
 * The QR code is printed once and never changes, so this value is fixed rather
 * than configured — nothing in the app generates a QR code or needs a base URL
 * to do so. It is here only so the customer entry point is written down in one
 * place.
 */
export const CUSTOMER_INTAKE_URL = 'https://atlas-ai-two-phi.vercel.app/session'
