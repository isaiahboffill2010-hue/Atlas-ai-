export type MusicCommand = 'play' | 'pause' | 'resume' | 'stop' | 'replay' | null

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

const REPLAY_PATTERNS = [
  /^replay(\s+the\s+song)?$/i,
  /^restart(\s+the\s+song)?$/i,
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

  // Check for stop command (most specific)
  for (const pattern of STOP_PATTERNS) {
    if (pattern.test(normalized)) {
      console.log(`[Music] Stop command detected`)
      return { command: 'stop' }
    }
  }

  // Check for pause command
  for (const pattern of PAUSE_PATTERNS) {
    if (pattern.test(normalized)) {
      console.log(`[Music] Pause command detected`)
      return { command: 'pause' }
    }
  }

  // Check for replay command (BEFORE resume, so it doesn't get caught)
  for (const pattern of REPLAY_PATTERNS) {
    if (pattern.test(normalized)) {
      console.log(`[Music] Replay command detected`)
      return { command: 'replay' }
    }
  }

  // Check for resume command (BEFORE play, so "play again" is caught as resume)
  for (const pattern of RESUME_PATTERNS) {
    if (pattern.test(normalized)) {
      console.log(`[Music] Resume command detected`)
      return { command: 'resume' }
    }
  }

  // Check for play command (most general - must be last)
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

  return { command: null }
}

export function isMusicCommand(command: MusicCommand): boolean {
  return command !== null
}
