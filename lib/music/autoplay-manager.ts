// Autoplay session management to prevent duplicate requests and handle stale requests

let currentSessionId = 0
let pendingAutoplayRequestId: NodeJS.Timeout | null = null
let lastPlayedSongId: string | null = null
let isAutoplayEnabled = true

const DEBUG = true

function log(message: string) {
  if (DEBUG) {
    console.log(`[Autoplay Manager] ${message}`)
  }
}

export function getNewSessionId(): number {
  currentSessionId++
  log(`New session created: ${currentSessionId}`)
  return currentSessionId
}

export function getCurrentSessionId(): number {
  return currentSessionId
}

export function isSessionValid(sessionId: number): boolean {
  const valid = sessionId === currentSessionId
  if (!valid) {
    log(`Session ${sessionId} is stale (current: ${currentSessionId})`)
  }
  return valid
}

export function enableAutoplay(): void {
  isAutoplayEnabled = true
  log('Autoplay enabled')
}

export function disableAutoplay(): void {
  isAutoplayEnabled = false
  cancelPendingAutoplay()
  log('Autoplay disabled')
}

export function isAutoplayActive(): boolean {
  return isAutoplayEnabled
}

export function setLastPlayedSongId(songId: string | null): void {
  lastPlayedSongId = songId
  if (songId) {
    log(`Last played song set: ${songId}`)
  } else {
    log('Last played song cleared')
  }
}

export function getLastPlayedSongId(): string | null {
  return lastPlayedSongId
}

export function schedulePendingAutoplay(
  sessionId: number,
  callback: () => Promise<void>,
  delayMs: number = 500
): void {
  if (!isSessionValid(sessionId)) {
    log(`Cannot schedule autoplay for stale session ${sessionId}`)
    return
  }

  // Cancel any existing pending request
  cancelPendingAutoplay()

  log(`Scheduling autoplay for session ${sessionId} in ${delayMs}ms`)

  pendingAutoplayRequestId = setTimeout(async () => {
    log(`Autoplay timer fired for session ${sessionId}`)

    // Double-check session is still valid
    if (!isSessionValid(sessionId)) {
      log(`Session ${sessionId} became stale, cancelling autoplay`)
      return
    }

    if (!isAutoplayEnabled) {
      log('Autoplay is disabled, skipping')
      return
    }

    try {
      log(`Executing autoplay callback for session ${sessionId}`)
      await callback()
    } catch (error) {
      console.error(`[Autoplay Manager] Error during autoplay: ${error}`)
    }

    pendingAutoplayRequestId = null
  }, delayMs)
}

export function cancelPendingAutoplay(): void {
  if (pendingAutoplayRequestId) {
    clearTimeout(pendingAutoplayRequestId)
    pendingAutoplayRequestId = null
    log('Cancelled pending autoplay request')
  }
}

export function isPendingAutoplayQueued(): boolean {
  return pendingAutoplayRequestId !== null
}

export function resetSession(): void {
  cancelPendingAutoplay()
  currentSessionId++
  isAutoplayEnabled = true
  lastPlayedSongId = null
  log(`Session reset. New session ID: ${currentSessionId}`)
}

export function getAutoplayState() {
  return {
    currentSessionId,
    isAutoplayEnabled,
    isPendingAutoplayQueued: isPendingAutoplayQueued(),
    lastPlayedSongId,
  }
}
