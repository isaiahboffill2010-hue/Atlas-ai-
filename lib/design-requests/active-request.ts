/**
 * The "active design request" — the one Atlas has claimed and is working on.
 *
 * When the watcher claims a request it records the id here, so the design
 * workspace can pick up exactly that request when the kiosk moves to
 * /atlasdesign. The server-generated request id is the only identifier used;
 * never the business name, and never anything the customer supplied.
 *
 * This is a hand-off hint, not a source of truth: the workspace always loads
 * the request itself from the server, and falls back to asking the server which
 * request is currently active if nothing is stored here.
 */

import { isValidRequestId } from './validation'

const STORAGE_KEY = 'atlas.activeDesignRequestId'

export function rememberActiveRequestId(requestId: string): void {
  if (typeof window === 'undefined' || !isValidRequestId(requestId)) return

  try {
    window.localStorage.setItem(STORAGE_KEY, requestId)
  } catch (error) {
    console.warn('[Active Request] Could not store the active request id:', error)
  }
}

export function readActiveRequestId(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isValidRequestId(stored) ? stored : null
  } catch (error) {
    console.warn('[Active Request] Could not read the active request id:', error)
    return null
  }
}

export function clearActiveRequestId(): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing useful to do if storage is unavailable.
  }
}
