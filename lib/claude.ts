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
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: message.trim() }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`API error: ${response.status} ${response.statusText} - ${text}`)
    }

    const data: ClaudeResponse = await response.json()
    const textContent = data.content.find((c) => c.type === 'text')
    return textContent?.text || 'No response from Claude'
  } catch (error) {
    console.error('Claude API error:', error)
    throw error
  }
}
