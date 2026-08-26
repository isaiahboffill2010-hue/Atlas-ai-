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
