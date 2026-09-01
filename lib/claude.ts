interface ClaudeResponse {
  content: Array<{
    type: string
    text?: string
  }>
}

export async function askClaude(message: string): Promise<string> {
  if (!message || message.trim().length === 0) {
    throw new Error('Empty message')
  }

  try {
    console.log('[ATLAS DEBUG] askClaude called with:', message.substring(0, 50))
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: message.trim() }),
    })

    console.log('[ATLAS DEBUG] Fetch completed, status:', response.status)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.log('[ATLAS DEBUG] Response not OK:', response.status)
      throw new Error(`API error: ${response.status} ${response.statusText} - ${text}`)
    }

    console.log('[ATLAS DEBUG] Response is OK, parsing JSON')
    const data: ClaudeResponse = await response.json()
    console.log('[ATLAS DEBUG] Response JSON parsed successfully')
    console.log('[ATLAS DEBUG] Response data:', JSON.stringify(data).substring(0, 300))
    console.log('[ATLAS DEBUG] Content array length:', data.content?.length || 0)

    const textContent = data.content.find((c) => c.type === 'text')
    console.log('[ATLAS DEBUG] Found text content:', !!textContent)

    const result = textContent?.text || 'No response from Claude'
    console.log('[ATLAS DEBUG] Extracted text:', result.substring(0, 100))
    console.log('[ATLAS DEBUG] askClaude returning text, length:', result.length)

    return result
  } catch (error) {
    console.error('[ATLAS DEBUG] askClaude error:', error)
    throw error
  }
}
