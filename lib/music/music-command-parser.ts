export type MusicCommand = 'play' | 'pause' | 'resume' | 'stop' | 'replay' | 'random' | null

export interface ParsedMusicCommand {
  command: MusicCommand
  query?: string
}

const PLAY_PATTERNS = [
  // Natural language: "can/could/would/will you [please] play [the song] <song>"
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?play(?:\s+(?:the\s+)?song)?\s+(.+)$/i,

  // Natural language: "please play [the song] <song>"
  /^please\s+play(?:\s+(?:the\s+)?song)?\s+(.+)$/i,

  // Existing direct commands
  /^play\s+(?:the\s+)?song\s+(.+)$/i,
  /^play\s+(.+)$/i,
  /^play\s+me\s+(.+)$/i,
  /^put\s+on\s+(.+)$/i,
]

const PAUSE_PATTERNS = [
  // Natural language
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?pause(?:\s+(?:the\s+)?music)?$/i,
  /^please\s+pause(?:\s+(?:the\s+)?music)?$/i,

  // Direct commands
  /^pause(?:\s+the\s+music)?$/i,
  /^pause\s+it$/i,
]

const RESUME_PATTERNS = [
  // Natural language
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:resume|unpause)(?:\s+(?:the\s+)?music)?$/i,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:continue|keep\s+playing)(?:\s+(?:the\s+)?music)?$/i,
  /^please\s+(?:resume|unpause|continue)(?:\s+(?:the\s+)?music)?$/i,

  // Direct commands
  /^resume(?:\s+the\s+music)?$/i,
  /^continue(?:\s+the\s+music)?$/i,
  /^play\s+again$/i,
  /^keep\s+playing(?:\s+the\s+music)?$/i,
  /^unpause(?:\s+the\s+music)?$/i,
]

const REPLAY_PATTERNS = [
  // Natural language
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:replay|restart)(?:\s+(?:the\s+)?song)?$/i,
  /^please\s+(?:replay|restart)(?:\s+(?:the\s+)?song)?$/i,

  // Direct commands
  /^replay(?:\s+the\s+song)?$/i,
  /^restart(?:\s+the\s+song)?$/i,
]

const STOP_PATTERNS = [
  // Natural language
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:stop|turn\s+off)(?:\s+(?:the\s+)?music)?$/i,
  /^please\s+(?:stop|turn\s+off)(?:\s+(?:the\s+)?music)?$/i,

  // Direct commands
  /^stop(?:\s+(?:the\s+)?(?:music|song))?$/i,
  /^turn\s+off\s+the\s+music$/i,
]

const RANDOM_SONG_PATTERNS = [
  // Natural language
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?play\s+a\s+(?:random\s+)?song$/i,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?play\s+something(?:\s+random)?$/i,
  /^please\s+play\s+a\s+(?:random\s+)?song$/i,
  /^please\s+play\s+something(?:\s+random)?$/i,

  // Direct commands
  /^play\s+a\s+song$/i,
  /^play\s+a\s+random\s+song$/i,
  /^play\s+something$/i,
  /^play\s+something\s+random$/i,
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

  // Check for random song command (BEFORE play, so "play a song" is caught as random)
  for (const pattern of RANDOM_SONG_PATTERNS) {
    if (pattern.test(normalized)) {
      console.log(`[Music] Random song command detected`)
      return { command: 'random' }
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
