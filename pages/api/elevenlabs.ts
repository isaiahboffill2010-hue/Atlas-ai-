import type { NextApiRequest, NextApiResponse } from 'next'

interface ElevenLabsResponse {
  audio?: string
  error?: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ElevenLabsResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text } = req.body

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Text is required' })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID

  if (!apiKey || !voiceId) {
    console.error('ElevenLabs API key or voice ID not configured')
    return res.status(500).json({ error: 'ElevenLabs not configured' })
  }

  try {
    console.log('[ElevenLabs] Requesting TTS for text:', text.substring(0, 50))

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('[ElevenLabs] Error:', response.status, error)
      return res.status(response.status).json({ error: `ElevenLabs error: ${response.statusText}` })
    }

    const audioBuffer = await response.arrayBuffer()
    const base64Audio = Buffer.from(audioBuffer).toString('base64')

    console.log('[ElevenLabs] TTS generated successfully, audio size:', audioBuffer.byteLength)

    return res.status(200).json({ audio: base64Audio })
  } catch (error) {
    console.error('[ElevenLabs] Error:', error)
    return res.status(500).json({ error: 'Failed to generate speech' })
  }
}
