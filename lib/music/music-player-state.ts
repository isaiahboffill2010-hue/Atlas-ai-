export type MusicPlayerState = 'stopped' | 'playing' | 'paused'

export interface CurrentSong {
  videoId: string
  title: string
  channel: string
  thumbnail: string
}

export interface MusicPlayerStore {
  state: MusicPlayerState
  currentSong: CurrentSong | null
  error: string | null
}

let musicPlayerStore: MusicPlayerStore = {
  state: 'stopped',
  currentSong: null,
  error: null,
}

let listeners: ((store: MusicPlayerStore) => void)[] = []

export function getMusicPlayerState(): MusicPlayerStore {
  return { ...musicPlayerStore }
}

export function setMusicPlayerState(newState: MusicPlayerState): void {
  console.log(`[MusicPlayer] State change: ${musicPlayerStore.state} → ${newState}`)
  musicPlayerStore.state = newState
  notifyListeners()
}

export function setCurrentSong(song: CurrentSong | null): void {
  const songTitle = song ? song.title : 'None'
  console.log(`[MusicPlayerState] setCurrentSong("${songTitle}") called`)
  console.log(`[MusicPlayerState] Song object:`, song)
  musicPlayerStore.currentSong = song
  console.log(`[MusicPlayerState] ✓ Store updated, notifying ${listeners.length} listeners`)
  notifyListeners()
  console.log(`[MusicPlayerState] ✓ Listeners notified`)
}

export function setMusicError(error: string | null): void {
  musicPlayerStore.error = error
  if (error) {
    console.error(`[MusicPlayer] Error: ${error}`)
  }
  notifyListeners()
}

export function resetMusicPlayer(): void {
  console.log('[MusicPlayer] Resetting')
  musicPlayerStore = {
    state: 'stopped',
    currentSong: null,
    error: null,
  }
  notifyListeners()
}

export function subscribe(listener: (store: MusicPlayerStore) => void): () => void {
  listeners.push(listener)

  // Return unsubscribe function
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener({ ...musicPlayerStore }))
}
