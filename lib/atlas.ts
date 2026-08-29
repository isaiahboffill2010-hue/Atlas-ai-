interface AtlasResponse {
  content: Array<{
    type: string
    text?: string
  }>
}

export async function askAtlas(message: string): Promise<string> {
  if (!message || message.trim().length === 0) {
    throw new Error('Empty message')
  }

  try {
    console.log('[askAtlas] Sending request to /api/atlas')
    const response = await fetch('/api/atlas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: message.trim() }),
    })

    console.log('[askAtlas] Fetch completed, status:', response.status)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.log('[askAtlas] Response not OK:', response.status)
      throw new Error(`API error: ${response.status} ${response.statusText} - ${text}`)
    }

    console.log('[askAtlas] Response is OK, parsing JSON')
    const data: AtlasResponse = await response.json()
    console.log('[askAtlas] Response JSON parsed successfully')

    const textContent = data.content.find((c) => c.type === 'text')
    const result = textContent?.text || 'No response from Atlas'
    console.log('[askAtlas] Extracted text, length:', result.length)

    return result
  } catch (error) {
    console.error('[askAtlas] Error:', error)
    throw error
  }
}
