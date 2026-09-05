/**
 * Tunables for the voice pipeline.
 *
 * These live in their own module so timing can be adjusted without touching
 * speech-recognition, streaming, or playback logic.
 */

/**
 * How long to wait after the last speech result before treating the customer's
 * request as finished.
 *
 * Was 2000ms. That wait sits directly between the customer finishing their
 * sentence and Atlas starting to answer, so it was a large share of the
 * perceived response delay. 1150ms is long enough to survive a normal
 * mid-sentence pause without cutting people off.
 *
 * Raise this if Atlas starts interrupting people mid-thought.
 */
export const SILENCE_TIMEOUT_MS = 1150

/**
 * Set NEXT_PUBLIC_ATLAS_STREAMING=false to fall back to the original
 * non-streaming pipeline (full Gemini response -> full ElevenLabs file ->
 * play). The non-streaming path is still present and fully functional.
 */
export const STREAMING_TTS_ENABLED = process.env.NEXT_PUBLIC_ATLAS_STREAMING !== 'false'

/** Emit [LATENCY] timing marks to the console. */
export const LATENCY_LOGGING_ENABLED = true
