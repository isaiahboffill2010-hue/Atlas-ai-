export type MusicCommand = 'play' | 'pause' | 'resume' | 'stop' | null

export interface ParsedMusicCommand {
  command: MusicCommand
  query?: string
}

const PLAY_PATTERNS = [
  /^play\s+(.+)$/i,
  /^play\s+me\s+(.+)$/i,
  /^put\s+on\s+(.+)$/i,
]

const PAUSE_PATTERNS = [
  /^pause(\s+the\s+music)?$/i,
  /^pause\s+it$/i,
]

const RESUME_PATTERNS = [
  /^resume(\s+the\s+music)?$/i,
  /^continue$/i,
  /^continue\s+the\s+music$/i,
  /^play\s+again$/i,
  /^keep\s+playing$/i,
  /^unpause$/i,
]

const STOP_PATTERNS = [
  /^stop(\s+the\s+music)?$/i,
  /^stop\s+the\s+song$/i,
  /^turn\s+off\s+the\s+music$/i,
]

export function parseMusicCommand(transcript: string): ParsedMusicCommand {
  if (!transcript || transcript.trim().length === 0) {
    return { command: null }
  }

  const normalized = transcript.trim()

  // Check for play command
  for (const pattern of PLAY_PATTERNS) {
    const match = normalized.match(pattern)
    if (match) {
      const query = match[1]?.trim()
      if (query) {
        console.log(`[Music] Play command detected: "${query}"`)
        return { command: 'play', query }
      }
    }
  }

  // Check for pause command
  for (const pattern of PAUSE_PATTERNS) {
    if (pattern.test(normalized)) {
      console.log(`[Music] Pause command detected`)
      return { command: 'pause' }
    }
  }

  // Check for resume command
  for (const pattern of RESUME_PATTERNS) {
    if (pattern.test(normalized)) {
      console.log(`[Music] Resume command detected`)
      return { command: 'resume' }
    }
  }

  // Check for stop command
  for (const pattern of STOP_PATTERNS) {
    if (pattern.test(normalized)) {
      console.log(`[Music] Stop music command detected`)
      return { command: 'stop' }
    }
  }

  return { command: null }
}

export function isMusicCommand(command: MusicCommand): boolean {
  return command !== null
}
