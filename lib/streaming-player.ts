import { LatencyTracker, MARKS } from './latency'

/**
 * Ordered streaming speech playback.
 *
 * Text chunks are handed in as soon as they are available. Each chunk is sent
 * to ElevenLabs immediately (up to MAX_INFLIGHT at a time), but playback walks
 * the queue strictly in sequence, so chunk 2 can never be heard before chunk 1
 * even if it finishes synthesising first.
 *
 * Phase 1 plays one HTMLAudioElement per chunk. That means a small gap at each
 * chunk boundary (element swap plus MP3 encoder padding). Phase 2 — a single
 * ElevenLabs WebSocket feeding a Web Audio timeline — is what removes those
 * gaps entirely.
 */

/** How many ElevenLabs requests may be in flight at once. */
const MAX_INFLIGHT = 2

export interface StreamingSpeechCallbacks {
  /** First audio bytes arrived from ElevenLabs. */
  onFirstAudioReceived?: () => void
  /** First audio actually started coming out of the speakers. */
  onFirstAudioPlaying?: () => void
  /** A chunk failed to synthesise. Playback continues with the next chunk. */
  onChunkError?: (error: Error, text: string) => void
}

interface QueuedChunk {
  seq: number
  text: string
  controller: AbortController
  audio: Promise<HTMLAudioElement | null>
}

/** The speech currently playing, so a global cancel can reach it. */
let activeSpeech: StreamingSpeech | null = null

export class StreamingSpeech {
  private readonly callbacks: StreamingSpeechCallbacks
  private readonly tracker: LatencyTracker | null

  private readonly chunks: QueuedChunk[] = []
  private readonly objectUrls: string[] = []
  /** One promise chain per concurrency slot; chunk N waits on chunk N-MAX_INFLIGHT. */
  private readonly slots: Promise<unknown>[] = []

  private nextSeq = 0
  private playIndex = 0
  private lastText = ''
  private inputDone = false
  private cancelled = false
  private playbackRunning = false
  private startedPlaying = false

  private currentAudio: HTMLAudioElement | null = null
  private wake: (() => void) | null = null

  private readonly finished: Promise<void>
  private resolveFinished!: () => void

  constructor(callbacks: StreamingSpeechCallbacks = {}, tracker: LatencyTracker | null = null) {
    this.callbacks = callbacks
    this.tracker = tracker
    this.finished = new Promise<void>((resolve) => {
      this.resolveFinished = resolve
    })
    activeSpeech = this
  }

  /** True once any audio has actually reached the speakers. */
  get hasPlayedAudio(): boolean {
    return this.startedPlaying
  }

  get isCancelled(): boolean {
    return this.cancelled
  }

  /** Queue a chunk of text. Synthesis starts immediately (subject to MAX_INFLIGHT). */
  enqueue(text: string): void {
    const trimmed = text.trim()
    if (!trimmed || this.cancelled || this.inputDone) return

    const seq = this.nextSeq++
    const previousText = this.lastText
    this.lastText = trimmed

    const controller = new AbortController()
    const slot = seq % MAX_INFLIGHT
    const waitFor = this.slots[slot] || Promise.resolve()

    const audio = waitFor
      .catch(() => undefined)
      .then(() => this.synthesize(seq, trimmed, previousText, controller))

    this.slots[slot] = audio.catch(() => undefined)
    this.chunks.push({ seq, text: trimmed, controller, audio })

    console.log(`[StreamingSpeech] queued chunk ${seq} (${trimmed.length} chars): "${trimmed}"`)

    this.notify()
    void this.runPlayback()
  }

  /**
   * No more text is coming. Resolves once every queued chunk has finished
   * playing, or immediately if the speech was cancelled.
   */
  finish(): Promise<void> {
    this.inputDone = true
    this.notify()
    void this.runPlayback()
    return this.finished
  }

  /**
   * Stop everything: abort in-flight ElevenLabs requests, stop the current
   * audio, and drop anything still queued.
   */
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.inputDone = true

    console.log(`[StreamingSpeech] cancelling (${this.chunks.length} chunks queued)`)

    for (const chunk of this.chunks) {
      try {
        chunk.controller.abort()
      } catch (e) {
        // already settled
      }
    }

    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
        this.currentAudio.currentTime = 0
      } catch (e) {
        // ignore
      }
      this.currentAudio = null
    }

    this.releaseUrls()
    this.notify()

    if (activeSpeech === this) activeSpeech = null
    this.resolveFinished()
  }

  private async synthesize(
    seq: number,
    text: string,
    previousText: string,
    controller: AbortController
  ): Promise<HTMLAudioElement | null> {
    if (this.cancelled) return null

    if (seq === 0) {
      this.tracker?.markOnce(MARKS.FIRST_TTS_REQUEST_STARTED, `${text.length} chars`)
    }

    try {
      const response = await fetch('/api/tts-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          // Gives ElevenLabs the preceding sentence so intonation carries across
          // chunk boundaries instead of restarting on every chunk.
          previousText: previousText || undefined,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`TTS request failed: ${response.status} ${detail.slice(0, 200)}`)
      }

      if (!response.body) {
        // No streaming body available — fall back to buffering the whole chunk.
        const blob = await response.blob()
        this.tracker?.markOnce(MARKS.FIRST_AUDIO_RECEIVED, 'no stream body')
        return this.cancelled ? null : this.createAudio(blob)
      }

      const reader = response.body.getReader()
      const parts: Uint8Array[] = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (this.cancelled) {
          try {
            await reader.cancel()
          } catch (e) {
            // ignore
          }
          return null
        }
        if (value) {
          if (received === 0) {
            this.tracker?.markOnce(MARKS.FIRST_AUDIO_RECEIVED, `chunk ${seq}`)
            if (seq === 0) this.callbacks.onFirstAudioReceived?.()
          }
          parts.push(value)
          received += value.byteLength
        }
      }

      if (this.cancelled) return null

      console.log(`[StreamingSpeech] chunk ${seq} audio ready (${received} bytes)`)
      return this.createAudio(new Blob(parts as BlobPart[], { type: 'audio/mpeg' }))
    } catch (error: any) {
      if (this.cancelled || error?.name === 'AbortError') return null
      console.error(`[StreamingSpeech] chunk ${seq} synthesis failed:`, error)
      this.callbacks.onChunkError?.(
        error instanceof Error ? error : new Error(String(error)),
        text
      )
      return null
    }
  }

  private createAudio(blob: Blob): HTMLAudioElement {
    const url = URL.createObjectURL(blob)
    this.objectUrls.push(url)
    const audio = new Audio(url)
    audio.volume = 1.0
    // Decode ahead of time so the handoff between chunks is as tight as possible.
    audio.preload = 'auto'
    try {
      audio.load()
    } catch (e) {
      // ignore
    }
    return audio
  }

  private async runPlayback(): Promise<void> {
    if (this.playbackRunning) return
    this.playbackRunning = true

    try {
      while (!this.cancelled) {
        if (this.playIndex >= this.chunks.length) {
          if (this.inputDone) break
          await this.waitForWork()
          continue
        }

        const chunk = this.chunks[this.playIndex]
        // Awaiting in sequence is what guarantees ordered playback: chunk N+1 is
        // never played until chunk N has finished, however fast it synthesised.
        const audio = await chunk.audio
        this.playIndex++

        if (this.cancelled) break
        if (!audio) continue

        await this.playOne(audio, chunk.seq)
      }
    } catch (error) {
      console.error('[StreamingSpeech] playback loop error:', error)
    } finally {
      this.playbackRunning = false
    }

    if (this.cancelled) return

    if (this.inputDone && this.playIndex >= this.chunks.length) {
      this.releaseUrls()
      if (activeSpeech === this) activeSpeech = null
      this.resolveFinished()
    }
  }

  private playOne(audio: HTMLAudioElement, seq: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        audio.onended = null
        audio.onerror = null
        audio.onplaying = null
        if (this.currentAudio === audio) this.currentAudio = null
        resolve()
      }

      this.currentAudio = audio

      audio.onplaying = () => {
        if (!this.startedPlaying) {
          this.startedPlaying = true
          this.tracker?.markOnce(MARKS.FIRST_AUDIO_PLAYED, `chunk ${seq}`)
          this.callbacks.onFirstAudioPlaying?.()
        }
      }

      audio.onended = done

      audio.onerror = () => {
        console.error(`[StreamingSpeech] playback error on chunk ${seq}`)
        done()
      }

      const started = audio.play()
      if (started && typeof started.catch === 'function') {
        started.catch((error: any) => {
          if (!this.cancelled && error?.name !== 'AbortError') {
            console.error(`[StreamingSpeech] play() rejected on chunk ${seq}:`, error)
          }
          done()
        })
      }
    })
  }

  private waitForWork(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wake = resolve
    })
  }

  private notify(): void {
    if (this.wake) {
      const wake = this.wake
      this.wake = null
      wake()
    }
  }

  private releaseUrls(): void {
    while (this.objectUrls.length > 0) {
      const url = this.objectUrls.pop()
      if (url) URL.revokeObjectURL(url)
    }
  }
}

/**
 * Cancel whatever streaming speech is currently active. Safe to call when
 * nothing is playing.
 */
export function cancelActiveStreamingSpeech(): void {
  if (activeSpeech) {
    activeSpeech.cancel()
    activeSpeech = null
  }
}
