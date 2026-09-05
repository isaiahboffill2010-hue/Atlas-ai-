import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Streaming counterpart to /api/elevenlabs.
 *
 * Differences from the original route:
 *  - calls ElevenLabs' /stream endpoint instead of the buffered one
 *  - pipes audio bytes straight through as they arrive, rather than waiting for
 *    the complete file, base64-encoding it, and wrapping it in JSON (which both
 *    forced full buffering on each side and inflated the payload by ~33%)
 *  - accepts `previousText` so ElevenLabs can carry intonation across chunk
 *    boundaries instead of restarting prosody on every sentence
 *
 * Voice, model and voice_settings are identical to the original route, so Atlas
 * sounds the same. /api/elevenlabs is untouched and still works.
 */

export const config = {
  api: {
    responseLimit: false,
  },
}

const MODEL_ID = 'eleven_flash_v2_5'
const OUTPUT_FORMAT = 'mp3_44100_128'
const REQUEST_TIMEOUT_MS = 20000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text, previousText } = req.body || {}

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Text is required' })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID

  if (!apiKey || !voiceId) {
    console.error('[TTSStream] ElevenLabs API key or voice ID not configured')
    return res.status(500).json({ error: 'ElevenLabs not configured' })
  }

  const started = Date.now()
  const since = () => `${Date.now() - started}ms`

  const controller = new AbortController()
  let clientGone = false
  const onClose = () => {
    clientGone = true
    controller.abort()
  }
  req.on('close', onClose)

  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream` +
      `?output_format=${OUTPUT_FORMAT}`

    const body: Record<string, unknown> = {
      text: text.trim(),
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }

    if (typeof previousText === 'string' && previousText.trim().length > 0) {
      body.previous_text = previousText.trim()
    }

    console.log(`[TTSStream] Synthesizing ${text.length} chars: "${text.slice(0, 60)}"`)

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      clearTimeout(timeoutId)
      console.error('[TTSStream] ElevenLabs error:', upstream.status, detail.slice(0, 400))
      return res
        .status(upstream.status)
        .json({ error: `ElevenLabs error: ${upstream.statusText}` })
    }

    if (!upstream.body) {
      clearTimeout(timeoutId)
      return res.status(502).json({ error: 'ElevenLabs returned no audio stream' })
    }

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    })

    const reader = (upstream.body as ReadableStream<Uint8Array>).getReader()
    let bytes = 0
    let firstByteLogged = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (clientGone || res.writableEnded) {
        await reader.cancel().catch(() => undefined)
        break
      }
      if (!value || value.byteLength === 0) continue

      if (!firstByteLogged) {
        firstByteLogged = true
        console.log(`[TTSStream] First audio byte at ${since()}`)
      }

      bytes += value.byteLength
      // Respect backpressure so a slow client cannot balloon memory here.
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => res.once('drain', resolve))
      }
    }

    clearTimeout(timeoutId)

    if (!res.writableEnded) res.end()
    console.log(`[TTSStream] Streamed ${bytes} bytes in ${since()}`)
  } catch (error: any) {
    clearTimeout(timeoutId)

    if (clientGone || error?.name === 'AbortError') {
      console.log('[TTSStream] Request aborted')
      if (!res.writableEnded) res.end()
      return
    }

    console.error('[TTSStream] Error:', error)
    if (res.headersSent) {
      if (!res.writableEnded) res.end()
    } else {
      res.status(500).json({ error: 'Failed to generate speech' })
    }
  } finally {
    req.off('close', onClose)
  }
}
