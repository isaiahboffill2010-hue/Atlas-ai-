import { LATENCY_LOGGING_ENABLED } from './voice-config'

/**
 * Timestamped latency tracking for a single conversational turn.
 *
 * Every mark is logged with two numbers: elapsed time since the turn started
 * (t=) and time since the previous mark (+). The turn clock starts when the
 * customer stops speaking, so t= is what the customer actually experiences.
 */

export interface LatencyMark {
  name: string
  at: number
  detail?: string
}

/** Mark names used by the streaming pipeline. Kept here so they stay consistent. */
export const MARKS = {
  USER_STOPPED_SPEAKING: 'user-stopped-speaking',
  GEMINI_REQUEST_STARTED: 'gemini-request-started',
  FIRST_GEMINI_TEXT: 'first-gemini-text',
  FIRST_CHUNK_READY: 'first-chunk-ready',
  FIRST_TTS_REQUEST_STARTED: 'first-tts-request-started',
  FIRST_AUDIO_RECEIVED: 'first-audio-received',
  FIRST_AUDIO_PLAYED: 'first-audio-played',
  GEMINI_COMPLETE: 'gemini-text-complete',
  RESPONSE_COMPLETE: 'final-response-completed',
} as const

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

let turnCounter = 0

export class LatencyTracker {
  readonly id: string
  /** Prefix for every log line, e.g. "[baseline][turn-3]" or just "[turn-3]". */
  private readonly prefix: string
  private readonly startedAt: number
  private readonly marks: LatencyMark[] = []
  private readonly seen = new Set<string>()

  constructor(label = 'turn', variant?: string) {
    turnCounter += 1
    this.id = `${label}-${turnCounter}`
    this.prefix = variant ? `[${variant}][${this.id}]` : `[${this.id}]`
    this.startedAt = now()
  }

  /** Record a mark. Repeated names are allowed. */
  mark(name: string, detail?: string): number {
    const at = now()
    const elapsed = at - this.startedAt
    const previous = this.marks.length > 0 ? this.marks[this.marks.length - 1].at : this.startedAt
    const delta = at - previous

    this.marks.push({ name, at, detail })
    this.seen.add(name)

    if (LATENCY_LOGGING_ENABLED) {
      const suffix = detail ? ` — ${detail}` : ''
      console.log(
        `[LATENCY]${this.prefix} ${name} t=${elapsed.toFixed(0)}ms (+${delta.toFixed(0)}ms)${suffix}`
      )
    }

    return elapsed
  }

  /** Record a mark only the first time this name is used. */
  markOnce(name: string, detail?: string): number | null {
    if (this.seen.has(name)) return null
    return this.mark(name, detail)
  }

  has(name: string): boolean {
    return this.seen.has(name)
  }

  elapsed(): number {
    return now() - this.startedAt
  }

  /** Elapsed time at a given mark, or null if it never happened. */
  at(name: string): number | null {
    const found = this.marks.find((m) => m.name === name)
    return found ? found.at - this.startedAt : null
  }

  /** Print the full turn timeline plus the two headline numbers. */
  summary(): void {
    if (!LATENCY_LOGGING_ENABLED) return

    const timeToFirstAudio = this.at(MARKS.FIRST_AUDIO_PLAYED)
    const total = this.elapsed()

    console.log(`[LATENCY]${this.prefix} ==================== TURN SUMMARY ====================`)
    for (const mark of this.marks) {
      const elapsed = mark.at - this.startedAt
      console.log(
        `[LATENCY]${this.prefix}   ${elapsed.toFixed(0).padStart(6)}ms  ${mark.name}${mark.detail ? ` — ${mark.detail}` : ''}`
      )
    }
    console.log(
      `[LATENCY]${this.prefix}   TIME TO FIRST AUDIO: ${
        timeToFirstAudio === null ? 'never played' : `${timeToFirstAudio.toFixed(0)}ms`
      }`
    )
    console.log(`[LATENCY]${this.prefix}   TOTAL TURN: ${total.toFixed(0)}ms`)
    console.log(`[LATENCY]${this.prefix} ======================================================`)
  }
}
