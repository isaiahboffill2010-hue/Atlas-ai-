import { PendingEmailAction } from './types'

export function isAffirmativeConfirmation(message: string): boolean {
  const normalized = message.toLowerCase().trim().replace(/[.!?]/g, '')
  return ['yes', 'yep', 'yeah', 'yup', 'sure', 'do it', 'go ahead', 'send it', 'please do', 'confirm', 'ok', 'okay'].includes(
    normalized
  )
}

export function isNegativeConfirmation(message: string): boolean {
  const normalized = message.toLowerCase().trim().replace(/[.!?]/g, '')
  return ['no', 'nope', 'cancel', "don't", 'do not', 'stop', 'not now', 'hold off'].includes(normalized)
}

export function summarizePendingEmailAction(action: PendingEmailAction): string {
  if (action.action === 'send_email') {
    const input = action.input
    const recipients = Array.isArray(input.to) ? input.to.join(', ') : input.to
    return `I can send an email to ${recipients} with the subject "${input.subject}". Should I send it?`
  }

  return `I can reply to that email with your message. Should I send the reply?`
}
