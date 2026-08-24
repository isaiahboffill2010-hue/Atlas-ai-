// OpenClaw tool and agent request detection
// OpenClaw is responsible for tool selection - we just detect if a request needs OpenClaw

// Patterns that suggest a user wants an action that requires OpenClaw
// (browser, file operations, etc.) rather than just a conversation response
export function requiresOpenClawAgent(message: string): boolean {
  const lowerMessage = message.toLowerCase()

  // Print requests - highest priority for file operations
  if (lowerMessage.includes('print')) {
    return true
  }

  // Search/lookup requests
  if (
    lowerMessage.includes('search') ||
    lowerMessage.includes('look up') ||
    lowerMessage.includes('find') ||
    lowerMessage.includes('google') ||
    lowerMessage.includes('browse') ||
    lowerMessage.includes('visit') ||
    lowerMessage.includes('check')
  ) {
    return true
  }

  // Action requests
  if (
    lowerMessage.includes('open') ||
    lowerMessage.includes('click') ||
    lowerMessage.includes('screenshot') ||
    lowerMessage.includes('send') ||
    lowerMessage.includes('download') ||
    lowerMessage.includes('upload') ||
    lowerMessage.includes('create file') ||
    lowerMessage.includes('read file') ||
    lowerMessage.includes('delete')
  ) {
    return true
  }

  return false
}

// Check if a message is requesting a print operation
export function isPrintRequest(message: string): boolean {
  return message.toLowerCase().includes('print')
}
