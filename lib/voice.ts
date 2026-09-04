import { speakText, stopSpeaking } from './tts'

const SILENCE_TIMEOUT_MS = 2000
const DEBUG = true

function log(message: string) {
  if (DEBUG) {
    console.log(`[Atlas Voice] ${message}`)
  }
}

interface VoiceCallbacks {
  onWakeWordDetected?: () => void
  onListeningStarted?: () => void
  onTranscript?: (text: string) => void
  onListeningEnded?: (finalTranscript: string) => void
  onError?: (error: string) => void
  onStopCommandDetected?: () => void
}

type SpeechRecognitionEvent = any
type SpeechRecognitionErrorEvent = any

interface ISpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onstart: ((this: ISpeechRecognition, ev: Event) => any) | null
  onresult: ((this: ISpeechRecognition, ev: SpeechRecognitionEvent) => any) | null
  onerror: ((this: ISpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null
  onend: ((this: ISpeechRecognition, ev: Event) => any) | null
}

function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
}

function matchesWakeWord(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript)
  // Match "hey" as the wake word (must be standalone, not part of another word)
  return (
    normalized === 'hey' ||
    normalized.startsWith('hey ') ||
    normalized.endsWith(' hey') ||
    normalized.includes(' hey ')
  )
}

function matchesStopCommand(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript)
  const stopPhrases = [
    'stop',
    'bye',
    'goodbye',
    'shut up',
    'be quiet',
    'thats enough',
    "that's enough",
    'im done',
    "i'm done",
    'never mind',
    'nevermind',
    'cancel',
  ]

  // Direct phrase match (entire transcript)
  if (stopPhrases.includes(normalized)) {
    return true
  }

  // Check for standalone phrases at start/end or surrounded by spaces
  for (const phrase of stopPhrases) {
    if (
      normalized === phrase ||
      normalized.startsWith(phrase + ' ') ||
      normalized.endsWith(' ' + phrase) ||
      normalized.includes(' ' + phrase + ' ')
    ) {
      return true
    }
  }

  return false
}

class VoiceInteraction {
  private recognition: ISpeechRecognition | null = null
  private requestRecognition: ISpeechRecognition | null = null
  private isListening = false
  private isSpeaking = false
  private silenceTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private requestRestartTimer: NodeJS.Timeout | null = null
  private finalTranscript = ''
  private interimTranscript = ''
  private callbacks: VoiceCallbacks = {}
  private mode: 'wake-word' | 'request' | null = null
  private isInitialized = false
  private intentionallyStopping = false
  private requestTranscript = ''
  private requestSessionId = 0
  private currentRequestSessionId = 0
  private requestSessionFinishing = false
  private pendingRequestListening: VoiceCallbacks | null = null
  private requestSessionInterimText = ''
  private savedRequestTranscript = ''
  private requestListeningActive = false
  private shouldIgnorePendingResponse = false
  private isWakeWordRestartPending = false
  private isRequestRestartPending = false

  constructor() {
    log('Initializing')
    this.initializeRecognition()
  }

  private initializeRecognition() {
    const SpeechRecognition =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null

    if (!SpeechRecognition) {
      log('ERROR: Speech Recognition not supported in this browser')
      this.callbacks.onError?.('Speech Recognition not supported')
      return
    }

    log('Speech recognition supported')
    this.recognition = new SpeechRecognition()
    this.isInitialized = true
  }

  startWakeWordDetection(callbacks: VoiceCallbacks) {
    log('Starting wake-word detection')
    this.callbacks = callbacks

    if (!this.recognition) {
      log('ERROR: Speech Recognition not initialized')
      callbacks.onError?.('Speech Recognition not initialized')
      return
    }

    if (this.isListening || this.isSpeaking) {
      log('ERROR: Already listening or speaking, cannot start wake-word detection')
      return
    }

    if (this.mode === 'wake-word') {
      log('Already detecting wake word')
      return
    }

    this.mode = 'wake-word'
    this.finalTranscript = ''
    this.interimTranscript = ''

    const recognition = this.recognition

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      log('[DEBUG] ✓ Wake-word recognition started')
      this.isListening = true
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      this.interimTranscript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        const confidence = event.results[i][0].confidence

        if (event.results[i].isFinal) {
          this.finalTranscript = transcript
          log(`Heard (final): "${transcript}" [confidence: ${(confidence * 100).toFixed(0)}%]`)

          if (matchesStopCommand(transcript)) {
            log('✓ Stop command detected during wake word detection')
            this.stopWakeWordDetection()
            callbacks.onStopCommandDetected?.()
            return
          }

          if (matchesWakeWord(transcript)) {
            log('✓ Wake word "Hey" detected - starting request capture')
            this.stopWakeWordDetection()
            callbacks.onWakeWordDetected?.()
            return
          }
        } else {
          this.interimTranscript = transcript
          log(`Hearing (interim): "${transcript}"`)
        }
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Ignore "aborted" errors when we're intentionally stopping
      if (event.error === 'aborted' && this.intentionallyStopping) {
        log('Recognition aborted (intentional)')
        return
      }

      // Treat "no-speech" as a normal idle/listening condition, not an error
      if (event.error === 'no-speech') {
        log('[DEBUG] No speech detected in wake-word mode, will auto-restart')
        if (this.mode === 'wake-word' && !this.intentionallyStopping) {
          log('[DEBUG] Scheduling wake-word restart due to no-speech')
          this.scheduleWakeWordRestart()
        }
        return
      }

      log(`[DEBUG] Wake-word error: ${event.error}`)
      if (event.error === 'network') {
        log('[DEBUG] Network error in wake-word mode')
      } else if (event.error === 'aborted') {
        log('[DEBUG] Recognition aborted unexpectedly')
      } else {
        log('[DEBUG] Other error in wake-word mode, may trigger restart on onend')
      }
      this.callbacks.onError?.(`Speech error: ${event.error}`)
    }

    recognition.onend = () => {
      log(`[DEBUG] Recognition ended (wake-word mode), isListening was: ${this.isListening}`)
      this.isListening = false

      // Check if we're transitioning to request listening
      if (this.pendingRequestListening) {
        log('[DEBUG] Transitioning from wake-word to request listening')
        const callbacks = this.pendingRequestListening
        this.pendingRequestListening = null
        this.setupRequestListening(callbacks)
        return
      }

      if (this.mode === 'wake-word' && !this.intentionallyStopping) {
        log(`[DEBUG] Unexpected recognition end in wake-word mode, scheduling restart. intentionallyStopping: ${this.intentionallyStopping}`)
        this.scheduleWakeWordRestart()
      } else {
        log(`[DEBUG] Recognition ended intentionally or mode changed. mode: ${this.mode}, intentionallyStopping: ${this.intentionallyStopping}`)
      }
    }

    try {
      log('Calling recognition.start()')
      recognition.start()
      log('recognition.start() succeeded')
    } catch (e) {
      log(`ERROR: Failed to start recognition: ${e}`)
      callbacks.onError?.('Failed to start wake word detection')
    }
  }

  private scheduleWakeWordRestart() {
    // Prevent multiple concurrent restart attempts
    if (this.isWakeWordRestartPending) {
      log('[DEBUG] Wake-word restart already pending, skipping duplicate schedule')
      return
    }

    this.clearRestartTimer()
    this.isWakeWordRestartPending = true
    log(`[DEBUG] Scheduling wake-word restart in 500ms (mode: ${this.mode}, isListening: ${this.isListening})`)
    this.restartTimer = setTimeout(() => {
      this.isWakeWordRestartPending = false
      log(`[DEBUG] Wake-word restart timeout fired. Checking: mode: ${this.mode}, isListening: ${this.isListening}`)
      if (this.mode === 'wake-word' && !this.isListening) {
        log('[DEBUG] Conditions met, restarting wake-word detection')
        try {
          if (this.recognition) {
            log('[DEBUG] Calling recognition.start()')
            this.recognition.start()
            log('[DEBUG] recognition.start() call completed')
          } else {
            log('[DEBUG] ERROR: recognition is null!')
          }
        } catch (e) {
          log(`[DEBUG] ERROR: Failed to restart: ${e}`)
        }
      } else {
        log(`[DEBUG] Conditions NOT met for restart. mode: ${this.mode}, isListening: ${this.isListening}`)
      }
    }, 500)
  }

  private scheduleRequestListeningRestart() {
    console.log('==================== VOICE RESTART SCHEDULED ====================')
    console.log('[VOICE] scheduleRequestListeningRestart()')
    console.log('[VOICE] Will retry in 300ms')

    // Prevent multiple concurrent restart attempts
    if (this.isRequestRestartPending) {
      console.log('[VOICE] NOT scheduling - already pending')
      log('[DEBUG] Request restart already pending, skipping duplicate schedule')
      return
    }

    this.clearRequestRestartTimer()
    this.isRequestRestartPending = true
    log(`[DEBUG] Scheduling request listening restart in 300ms (mode: ${this.mode}, isListening: ${this.isListening}, requestListeningActive: ${this.requestListeningActive})`)
    this.requestRestartTimer = setTimeout(() => {
      console.log('==================== VOICE RESTART ATTEMPT ====================')
      console.log('[VOICE] Restart timeout fired - evaluating conditions...')
      this.isRequestRestartPending = false
      log('[DEBUG] Request listening restart timeout fired. Checking conditions...')
      log(`[DEBUG] mode: ${this.mode}, isListening: ${this.isListening}, requestListeningActive: ${this.requestListeningActive}, requestSessionFinishing: ${this.requestSessionFinishing}`)
      if (this.mode === 'request' && !this.isListening && this.requestListeningActive && !this.requestSessionFinishing) {
        console.log('[VOICE] CONDITIONS MET - RESTARTING LISTENING')
        log('[DEBUG] Conditions met, restarting request listening')
        try {
          if (!this.requestRecognition) {
            log('[DEBUG] requestRecognition is null, recreating it...')
            this.recreateRequestRecognitionForRestart()
          }

          if (this.requestRecognition) {
            log('[DEBUG] Calling requestRecognition.start()')
            this.requestRecognition.start()
            log('[DEBUG] requestRecognition.start() call completed')
          } else {
            log('[DEBUG] ERROR: requestRecognition is still null after recreation!')
          }
        } catch (e) {
          console.log('[VOICE] ERROR during restart: ' + e)
          log(`[DEBUG] ERROR: Failed to restart request listening: ${e}`)
        }
      } else {
        console.log('[VOICE] NOT RESTARTING - conditions not met')
        console.log('[VOICE] mode=' + this.mode + ' (need "request")')
        console.log('[VOICE] isListening=' + this.isListening + ' (need false)')
        console.log('[VOICE] requestListeningActive=' + this.requestListeningActive + ' (need true)')
        console.log('[VOICE] requestSessionFinishing=' + this.requestSessionFinishing + ' (need false)')
        log('[DEBUG] Conditions NOT met for request restart')
      }
      console.log('============================================================')
    }, 300)
  }

  private recreateRequestRecognitionForRestart() {
    log('[DEBUG] Recreating request recognition instance for restart')

    // Get current session ID to ensure we use the right session
    const sessionId = this.currentRequestSessionId
    const callbacks = this.callbacks

    // Create a fresh recognition instance
    const SpeechRecognition =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null

    if (!SpeechRecognition) {
      log('[DEBUG] ERROR: SpeechRecognition not available for recreation')
      return
    }

    log(`[DEBUG] Creating new recognition instance (sessionId: ${sessionId})`)
    const recognition = new SpeechRecognition()
    this.requestRecognition = recognition

    this.mode = 'request'

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      // Ignore if this is a stale session
      if (sessionId !== this.currentRequestSessionId) {
        log('[DEBUG] Request onstart: stale session (recreated), ignoring')
        return
      }
      log(`[DEBUG] ✓ Request capture restarted (sessionId: ${sessionId})`)
      this.isListening = true
      this.requestTranscript = ''
      callbacks.onListeningStarted?.()
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Ignore if this is a stale session
      if (sessionId !== this.currentRequestSessionId) return

      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript

        if (event.results[i].isFinal) {
          log(`[DEBUG] Final request transcript (recreated): "${transcript}"`)

          if (matchesStopCommand(transcript)) {
            log('[DEBUG] Stop command detected during recreated request listening')
            this.clearSilenceTimer()
            this.requestSessionFinishing = true
            this.shouldIgnorePendingResponse = true
            if (this.requestRecognition && this.isListening) {
              try {
                ;(this.requestRecognition as any).abort()
              } catch (e) {
                // ignore
              }
            }
            callbacks.onStopCommandDetected?.()
            return
          }

          this.requestTranscript += transcript + ' '
        } else {
          interimText += transcript
        }
      }

      this.requestSessionInterimText = interimText
      const currentTranscript = this.requestTranscript + interimText
      log(`[DEBUG] Transcript (recreated): "${currentTranscript}"`)
      callbacks.onTranscript?.(currentTranscript)

      this.resetSilenceTimer()
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Ignore if this is a stale session
      if (sessionId !== this.currentRequestSessionId) {
        log('[DEBUG] Request onerror (recreated): stale session, ignoring')
        return
      }

      // Don't report intentional aborts or "no-speech" errors
      if (this.requestSessionFinishing && event.error === 'aborted') {
        log('[DEBUG] Request recognition aborted (intentional, recreated)')
        return
      }

      log(`[DEBUG] Error during recreated request capture: ${event.error}`)
      if (event.error === 'no-speech') {
        log('[DEBUG] No speech detected during recreated request - will handle in onend')
      } else {
        log(`[DEBUG] Other error during recreated request: ${event.error}`)
        callbacks.onError?.(`Speech error: ${event.error}`)
      }
    }

    recognition.onend = () => {
      console.log('==================== VOICE RECOGNITION EVENT ====================')
      console.log('[VOICE] speechRecognition.onend')
      console.log('[VOICE] sessionId=' + sessionId + ' currentRequestSessionId=' + this.currentRequestSessionId)
      console.log('[VOICE] isListening=' + this.isListening + ' requestSessionFinishing=' + this.requestSessionFinishing)
      console.log('[VOICE] requestListeningActive=' + this.requestListeningActive + ' isSpeaking=' + this.isSpeaking)
      console.log('==============================================================')

      // Ignore if this is a stale session
      if (sessionId !== this.currentRequestSessionId) {
        console.log('[VOICE] NOT restarting - stale session (old sessionId)')
        log(`[DEBUG] Request onend (recreated): stale session, ignoring`)
        return
      }

      log(`[DEBUG] Recreated recognition ended, isListening was: ${this.isListening}`)
      this.isListening = false
      this.clearSilenceTimer()
      this.requestRecognition = null

      // If we were finishing, call the callback with final transcript
      if (this.requestSessionFinishing) {
        console.log('[VOICE] NOT restarting - session finishing normally')
        const transcript = this.savedRequestTranscript.trim()
        log(`[DEBUG] Recreated request session finished with transcript: "${transcript}"`)
        callbacks.onListeningEnded?.(transcript)

        // Clean up
        this.savedRequestTranscript = ''
        this.requestSessionInterimText = ''
        this.requestTranscript = ''
        this.requestListeningActive = false
      } else if (this.requestListeningActive && !this.isSpeaking) {
        console.log('[VOICE] Attempting AUTOMATIC RESTART')
        log(`[DEBUG] Recreated request listening ended unexpectedly while still active`)
        this.scheduleRequestListeningRestart()
      }
    }

    log('[DEBUG] Request recognition recreated with all handlers')
  }

  private clearRestartTimer() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  private clearRequestRestartTimer() {
    if (this.requestRestartTimer) {
      clearTimeout(this.requestRestartTimer)
      this.requestRestartTimer = null
    }
  }

  private stopWakeWordDetection() {
    log('Stopping wake-word detection')
    this.clearRestartTimer()
    this.isWakeWordRestartPending = false
    this.intentionallyStopping = true
    this.mode = null
    if (this.recognition && this.isListening) {
      try {
        ;(this.recognition as any).abort()
      } catch (e) {
        try {
          this.recognition.stop()
        } catch (e2) {
          log(`Error stopping recognition: ${e2}`)
        }
      }
    }
    // Clear the flag after a brief delay to allow onend to fire
    setTimeout(() => {
      this.intentionallyStopping = false
    }, 100)
  }

  async pauseWakeWordDetection() {
    log('Pausing wake-word detection')
    this.clearRestartTimer()
    this.intentionallyStopping = true

    if (this.mode === 'wake-word') {
      this.mode = null
    }

    if (this.recognition && this.isListening) {
      try {
        ;(this.recognition as any).abort()
      } catch (e) {
        try {
          this.recognition.stop()
        } catch (e2) {
          log(`Error pausing wake-word recognition: ${e2}`)
        }
      }
    }

    setTimeout(() => {
      this.intentionallyStopping = false
    }, 100)
  }

  startListeningForRequest(callbacks: VoiceCallbacks) {
    log('Switching to listening (request capture mode)')
    this.callbacks = callbacks

    if (this.isSpeaking) {
      log('ERROR: Already speaking, cannot start listening')
      return
    }

    // Store callbacks for when wake-word recognition ends
    this.pendingRequestListening = callbacks

    // Stop wake-word detection (will transition to request listening in its onend handler)
    this.stopWakeWordDetection()
  }

  resumeRequestListening(callbacks: VoiceCallbacks) {
    log('Resuming request listening (continuing conversation)')
    this.callbacks = callbacks

    if (this.isSpeaking) {
      log('ERROR: Already speaking, cannot resume listening')
      return
    }

    // Directly set up request listening without stopping wake-word detection
    // (we're already in request listening mode, just restarting it)
    this.setupRequestListening(callbacks)
  }

  private setupRequestListening(callbacks: VoiceCallbacks) {
    // Clean up any previous request recognition instance
    if (this.requestRecognition) {
      try {
        ;(this.requestRecognition as any).abort()
      } catch (e) {
        // ignore
      }
    }

    // Create a fresh recognition instance for request listening
    const SpeechRecognition =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null

    if (!SpeechRecognition) {
      log('ERROR: Speech Recognition not available for request listening')
      callbacks.onError?.('Speech Recognition not available')
      return
    }

    // Increment session ID for this request session
    this.requestSessionId++
    this.currentRequestSessionId = this.requestSessionId
    this.requestSessionFinishing = false
    this.requestListeningActive = true

    log('Creating new recognition instance for request listening')
    const recognition = new SpeechRecognition()
    this.requestRecognition = recognition
    const sessionId = this.currentRequestSessionId

    this.mode = 'request'

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      // Ignore if this is a stale session
      if (sessionId !== this.currentRequestSessionId) {
        log('[DEBUG] Request onstart: stale session, ignoring')
        return
      }

      log(`[DEBUG] ✓ Request capture started (sessionId: ${sessionId})`)
      this.isListening = true
      // Reset transcript when request recognition actually starts
      this.requestTranscript = ''
      callbacks.onListeningStarted?.()
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Ignore if this is a stale session
      if (sessionId !== this.currentRequestSessionId) return

      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript

        if (event.results[i].isFinal) {
          log(`Final request transcript: "${transcript}"`)

          if (matchesStopCommand(transcript)) {
            log('✓ Stop command detected during request listening')
            this.clearSilenceTimer()
            this.requestSessionFinishing = true
            this.shouldIgnorePendingResponse = true
            if (this.requestRecognition && this.isListening) {
              try {
                ;(this.requestRecognition as any).abort()
              } catch (e) {
                // ignore
              }
            }
            callbacks.onStopCommandDetected?.()
            return
          }

          this.requestTranscript += transcript + ' '
        } else {
          interimText += transcript
        }
      }

      // Store interim text for silence timeout capture
      this.requestSessionInterimText = interimText

      const currentTranscript = this.requestTranscript + interimText
      log(`Transcript: "${currentTranscript}"`)
      callbacks.onTranscript?.(currentTranscript)

      this.resetSilenceTimer()
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Ignore if this is a stale session
      if (sessionId !== this.currentRequestSessionId) {
        log('[DEBUG] Request onerror: stale session, ignoring')
        return
      }

      // Don't report intentional aborts or "no-speech" errors
      if (this.requestSessionFinishing && event.error === 'aborted') {
        log('[DEBUG] Request recognition aborted (intentional)')
        return
      }

      log(`[DEBUG] Error during request capture: ${event.error}`)
      if (event.error === 'no-speech') {
        log('[DEBUG] No speech detected during request - likely will end recognition, onend will handle restart')
      } else {
        log(`[DEBUG] Other error during request: ${event.error}`)
        this.callbacks.onError?.(`Speech error: ${event.error}`)
      }
    }

    recognition.onend = () => {
      // Ignore if this is a stale session
      if (sessionId !== this.currentRequestSessionId) {
        log(`[DEBUG] Request onend: stale session (current: ${this.currentRequestSessionId}, got: ${sessionId}), ignoring`)
        return
      }

      log(`[DEBUG] Recognition ended (request mode), isListening was: ${this.isListening}`)
      this.isListening = false
      this.clearSilenceTimer()
      this.requestRecognition = null

      // If we were finishing, now call the callback with the final transcript
      if (this.requestSessionFinishing) {
        const transcript = this.savedRequestTranscript.trim()
        log(`[DEBUG] Request session finished with transcript: "${transcript}"`)
        this.callbacks.onListeningEnded?.(transcript)

        // Clean up after callback has been invoked
        this.savedRequestTranscript = ''
        this.requestSessionInterimText = ''
        this.requestTranscript = ''
        this.requestListeningActive = false
      } else if (this.requestListeningActive && !this.isSpeaking) {
        // Browser stopped listening unexpectedly while we're still in request mode
        // Schedule auto-restart to keep the mic active
        log(`[DEBUG] Request listening ended unexpectedly while still active. isSpeaking: ${this.isSpeaking}, requestListeningActive: ${this.requestListeningActive}`)
        log('[DEBUG] Scheduling request listening restart')
        this.scheduleRequestListeningRestart()
      } else {
        log(`[DEBUG] Request listening ended: requestListeningActive: ${this.requestListeningActive}, isSpeaking: ${this.isSpeaking}, requestSessionFinishing: ${this.requestSessionFinishing}`)
      }
    }

    try {
      log('Starting request recognition')
      recognition.start()
    } catch (e) {
      log(`ERROR: Failed to start listening for request: ${e}`)
      this.requestRecognition = null
      callbacks.onError?.('Failed to start listening')
    }
  }

  private resetSilenceTimer() {
    this.clearSilenceTimer()
    this.silenceTimer = setTimeout(() => {
      log('Silence timeout reached')
      this.endListening()
    }, SILENCE_TIMEOUT_MS)
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  endListening() {
    console.log('[VOICE] endListening() called | isListening=' + this.isListening + ' mode=' + this.mode)
    log('Silence timeout reached')
    this.clearSilenceTimer()
    this.clearRequestRestartTimer()
    this.isRequestRestartPending = false

    // Capture the final transcript BEFORE aborting (includes interim results)
    const finalTranscript = this.requestTranscript + this.requestSessionInterimText
    this.savedRequestTranscript = finalTranscript

    this.mode = null

    // Mark the request session as finishing (so intentional abort isn't reported as error)
    this.requestSessionFinishing = true

    // Stop the request recognition if it's running
    if (this.requestRecognition && this.isListening) {
      console.log('[VOICE] Aborting/stopping request recognition')
      try {
        ;(this.requestRecognition as any).abort()
      } catch (e) {
        try {
          this.requestRecognition.stop()
        } catch (e2) {
          log(`Error stopping request recognition: ${e2}`)
        }
      }
    } else {
      console.log('[VOICE] Recognition not running or not listening: requestRecognition=' + !!this.requestRecognition + ' isListening=' + this.isListening)
    }

    // Don't call the callback here - let the request recognition's onend handler do it
    // This ensures the recognition has fully stopped and final transcripts are accumulated
  }

  setSpeaking(isSpeaking: boolean) {
    this.isSpeaking = isSpeaking
    log(`Speaking: ${isSpeaking}`)
  }

  getPendingResponseIgnoreFlag(): boolean {
    return this.shouldIgnorePendingResponse
  }

  resetPendingResponseIgnoreFlag() {
    this.shouldIgnorePendingResponse = false
  }

  async speak(text: string, onEnd?: () => void): Promise<void> {
    try {
      log('Starting ElevenLabs TTS')
      await speakText(text, () => {
        log('TTS finished')
        onEnd?.()
      })
    } catch (error) {
      log(`TTS error: ${error}`)
      this.callbacks.onError?.(`Speech synthesis error: ${error}`)
      onEnd?.()
    }
  }

  async cancel() {
    log('Cancelling all operations')
    this.clearSilenceTimer()
    this.clearRestartTimer()
    this.clearRequestRestartTimer()
    this.isWakeWordRestartPending = false
    this.isRequestRestartPending = false
    this.mode = null
    this.requestListeningActive = false

    // Cancel request recognition if active
    if (this.requestRecognition) {
      try {
        ;(this.requestRecognition as any).abort()
      } catch (e) {
        // ignore
      }
      this.requestRecognition = null
    }

    // Cancel wake-word recognition if active
    if (this.recognition && this.isListening) {
      try {
        log('Aborting recognition')
        ;(this.recognition as any).abort()
      } catch (e) {
        try {
          log('Abort failed, trying stop')
          this.recognition.stop()
        } catch (e2) {
          log(`Error stopping recognition: ${e2}`)
        }
      }
    }

    // Stop TTS playback
    stopSpeaking()

    this.isSpeaking = false
    this.isListening = false
  }
}

export const voiceInteraction = new VoiceInteraction()
