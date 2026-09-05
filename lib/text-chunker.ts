/**
 * Incremental sentence chunker for streaming LLM text.
 *
 * Text arrives from Gemini a few tokens at a time. This buffers it and emits
 * complete, natural-sounding chunks as soon as they are available, so each
 * chunk can be sent to text-to-speech while the rest of the response is still
 * being generated.
 *
 * A chunk is only emitted when we are confident the sentence actually ended.
 * That matters here more than in most apps: a print shop says things like
 * "$4.99", "8.5 x 11", "No. 10 envelopes" and "11 a.m." all day, and a naive
 * split on "." would cut those in half mid-number and produce audible garbage.
 */

/** Words that end in a period without ending a sentence. */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'ave',
  'blvd',
  'rd',
  'dept',
  'no',
  'vs',
  'etc',
  'inc',
  'ltd',
  'co',
  'corp',
  'est',
  'approx',
  'min',
  'max',
  'qty',
  'fig',
  'ext',
  'apt',
  'ste',
  'pkg',
  'ea',
  'mon',
  'tue',
  'tues',
  'wed',
  'thu',
  'thur',
  'thurs',
  'fri',
  'sat',
  'sun',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sept',
  'sep',
  'oct',
  'nov',
  'dec',
])

/** Punctuation that can end a sentence. */
const SENTENCE_END = new Set(['.', '!', '?', '…'])

/** Characters that may trail sentence-ending punctuation and belong to the chunk. */
const CLOSERS = new Set(['"', "'", ')', ']', '}', '”', '’', '»'])

/** Weaker boundaries, used only when a chunk is getting too long. */
const SOFT_BREAK = new Set([',', ';', ':', '—', '–'])

export interface SentenceChunkerOptions {
  /**
   * Minimum length of the very first chunk. Kept short so Atlas starts talking
   * quickly — "Hi there!" is a perfectly natural thing to say on its own.
   */
  firstChunkMinChars?: number
  /**
   * Minimum length of every later chunk. Larger than the first so that
   * mid-response chunks carry enough context to be spoken with good prosody.
   */
  minChars?: number
  /**
   * Above this length with no sentence boundary in sight, stop waiting: break
   * at a comma if there is one, otherwise at a word boundary.
   */
  softMaxChars?: number
  /** How far past the soft cap to look for a comma before giving up on one. */
  hardMaxChars?: number
}

const DEFAULTS: Required<SentenceChunkerOptions> = {
  // Low enough that a natural opener like "Hi there!" (9 chars) goes out on its
  // own, high enough that "Sure." does not become its own request.
  firstChunkMinChars: 8,
  minChars: 45,
  softMaxChars: 160,
  hardMaxChars: 300,
}

export class SentenceChunker {
  private buffer = ''
  private emittedCount = 0
  private readonly options: Required<SentenceChunkerOptions>

  constructor(options: SentenceChunkerOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  /** Feed newly streamed text. Returns any chunks that became complete. */
  push(text: string): string[] {
    if (!text) return []
    this.buffer += text

    const chunks: string[] = []
    let next = this.takeChunk()
    while (next !== null) {
      chunks.push(next)
      next = this.takeChunk()
    }
    return chunks
  }

  /**
   * Emit whatever is left once the stream has ended. The minimum-length rules
   * do not apply here — the remaining text is all there will ever be.
   */
  flush(): string | null {
    const remaining = this.buffer.trim()
    this.buffer = ''
    if (!remaining) return null
    this.emittedCount += 1
    return remaining
  }

  /** Text buffered but not yet emitted. Useful for debugging. */
  get pending(): string {
    return this.buffer
  }

  get emitted(): number {
    return this.emittedCount
  }

  private get minChars(): number {
    return this.emittedCount === 0 ? this.options.firstChunkMinChars : this.options.minChars
  }

  private takeChunk(): string | null {
    const buffer = this.buffer
    if (!buffer.trim()) return null

    const min = this.minChars

    // 1. Prefer a real sentence boundary.
    for (let i = 0; i < buffer.length; i++) {
      if (!SENTENCE_END.has(buffer[i])) continue

      const end = this.boundaryEnd(buffer, i)
      if (end < 0) continue

      // Nothing after the punctuation yet — we cannot tell whether the sentence
      // ended or more characters are still coming (e.g. "4." then "99").
      if (end >= buffer.length) return null
      if (!/\s/.test(buffer[end])) continue

      const candidate = buffer.slice(0, end).trim()
      if (candidate.length < min) continue

      this.consume(end)
      return candidate
    }

    // Reaching here means there is no usable sentence boundary anywhere in the
    // buffer. Once it grows past the soft cap, break it somewhere sensible
    // rather than letting the customer wait for punctuation that may not come.
    if (buffer.length < this.options.softMaxChars) return null

    // 2. Prefer a comma or semicolon.
    const softEnd = this.lastSoftBreak(buffer, min, this.options.hardMaxChars)
    if (softEnd > 0) {
      const candidate = buffer.slice(0, softEnd).trim()
      if (candidate.length >= min) {
        this.consume(softEnd)
        return candidate
      }
    }

    // 3. Otherwise break at a word boundary so we never split a word in half.
    const limit = Math.min(buffer.length - 1, this.options.softMaxChars)
    for (let i = limit; i > min; i--) {
      if (!/\s/.test(buffer[i])) continue
      const candidate = buffer.slice(0, i).trim()
      if (candidate.length > 0) {
        this.consume(i)
        return candidate
      }
    }

    return null
  }

  private consume(end: number): void {
    this.buffer = this.buffer.slice(end).replace(/^\s+/, '')
    this.emittedCount += 1
  }

  /**
   * If `buffer[i]` genuinely ends a sentence, returns the index just past the
   * punctuation and any trailing quotes/brackets. Returns -1 otherwise.
   */
  private boundaryEnd(buffer: string, i: number): number {
    const char = buffer[i]

    if (char === '.') {
      // Part of an ellipsis — only the final dot can be a boundary.
      if (buffer[i + 1] === '.') return -1

      // Decimal or dimension: 4.99, 8.5, 11.17
      const before = buffer[i - 1] || ''
      const after = buffer[i + 1] || ''
      if (/\d/.test(before) && /\d/.test(after)) return -1

      const head = buffer.slice(0, i)

      // Dotted abbreviations: a.m., p.m., e.g., i.e., U.S.
      if (/(^|[\s(])([A-Za-z]\.)+[A-Za-z]$/.test(head)) return -1

      const wordMatch = /([A-Za-z]+)$/.exec(head)
      if (wordMatch) {
        const word = wordMatch[1]
        // Single capital letter: an initial, as in "J. Smith".
        if (word.length === 1 && word === word.toUpperCase()) return -1
        if (ABBREVIATIONS.has(word.toLowerCase())) return -1
      }
    }

    let end = i + 1
    while (end < buffer.length && CLOSERS.has(buffer[end])) {
      end++
    }

    // A period followed by a lowercase word is almost always an abbreviation we
    // did not catch, not a sentence break. "!" and "?" are unambiguous.
    if (char === '.') {
      const nextWord = /^\s+(\S)/.exec(buffer.slice(end))
      if (nextWord && /[a-z]/.test(nextWord[1])) return -1
    }

    return end
  }

  /** Index just past the last comma-like break within [min, limit]. */
  private lastSoftBreak(buffer: string, min: number, limit: number): number {
    const upper = Math.min(buffer.length - 1, limit)
    for (let i = upper; i > min; i--) {
      if (!SOFT_BREAK.has(buffer[i])) continue
      if (i + 1 < buffer.length && /\s/.test(buffer[i + 1])) {
        return i + 1
      }
    }
    return -1
  }
}
