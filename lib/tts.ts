interface TTSResponse {
  audio?: string
  error?: string
}

let currentAudio: HTMLAudioElement | null = null

export async function speakText(text: string, onEnd?: () => void): Promise<void> {
  if (!text || text.trim().length === 0) {
    console.error('[TTS] Empty text provided')
    throw new Error('Text is required for TTS')
  }

  return new Promise(async (resolve, reject) => {
    try {
      console.log('[TTS] Requesting speech synthesis:', text.substring(0, 50))

      const response = await fetch('/api/elevenlabs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: text.trim() }),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error('[TTS] API error:', error)
        throw new Error(error.error || 'Failed to generate speech')
      }

      const data: TTSResponse = await response.json()

      if (!data.audio) {
        console.error('[TTS] No audio in response')
        throw new Error('No audio generated')
      }

      console.log('[TTS] Audio received, playing...')

      // Stop any currently playing audio
      if (currentAudio) {
        currentAudio.pause()
        currentAudio.currentTime = 0
      }

      // Create audio element from base64
      const audioBlob = base64ToBlob(data.audio, 'audio/mpeg')
      const audioUrl = URL.createObjectURL(audioBlob)

      currentAudio = new Audio(audioUrl)
      currentAudio.volume = 1.0

      currentAudio.onplay = () => {
        console.log('[TTS] Playing audio')
      }

      currentAudio.onended = () => {
        console.log('[TTS] Audio finished')
        URL.revokeObjectURL(audioUrl)
        if (onEnd) onEnd()
        resolve()
      }

      currentAudio.onerror = (error) => {
        console.error('[TTS] Audio playback error:', error)
        URL.revokeObjectURL(audioUrl)
        reject(new Error('Audio playback failed'))
      }

      // Play the audio
      const playPromise = currentAudio.play()

      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.error('[TTS] Play error:', error)
          reject(error)
        })
      }
    } catch (error) {
      console.error('[TTS] Error:', error)
      reject(error)
    }
  })
}

export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64)
  const byteNumbers = new Array(byteCharacters.length)

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }

  const byteArray = new Uint8Array(byteNumbers)
  return new Blob([byteArray], { type: mimeType })
}
