import React, { useEffect, useRef } from 'react'
import { frontDeskConfig, FrontDeskDebugState } from '../lib/frontDesk'

declare global {
  interface WindowEventMap {
    'atlas-front-desk-simulate-person': CustomEvent<void>
  }
}

interface FrontDeskPresenceDetectorProps {
  enabled: boolean
  canTriggerPresence: () => boolean
  onPresenceConfirmed: () => void | Promise<void>
  onDebugStateChange?: (state: FrontDeskDebugState) => void
}

const DEBUG_PREFIX = '[Front Desk]'

function emitDebug(
  onDebugStateChange: FrontDeskPresenceDetectorProps['onDebugStateChange'],
  next: Partial<FrontDeskDebugState> & Pick<FrontDeskDebugState, 'cameraStatus' | 'personStatus' | 'frontDeskActive' | 'message'>
) {
  onDebugStateChange?.(next)
}

function log(message: string) {
  console.log(`${DEBUG_PREFIX} ${message}`)
}

function warn(message: string) {
  console.warn(`${DEBUG_PREFIX} ${message}`)
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const FrontDeskPresenceDetector: React.FC<FrontDeskPresenceDetectorProps> = ({
  enabled,
  canTriggerPresence,
  onPresenceConfirmed,
  onDebugStateChange,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const modelRef = useRef<any>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const activeRef = useRef(false)
  const detectionLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const simulateTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const latestCanTriggerRef = useRef(canTriggerPresence)
  const latestOnPresenceConfirmedRef = useRef(onPresenceConfirmed)
  const presenceCandidateSinceRef = useRef<number | null>(null)
  const presenceActiveRef = useRef(false)
  const presenceSessionTriggeredRef = useRef(false)
  const presenceSessionSuppressedRef = useRef(false)
  const lastSeenAtRef = useRef<number | null>(null)
  const cooldownUntilRef = useRef(0)
  const debugStateRef = useRef<FrontDeskDebugState>({
    cameraStatus: 'disabled',
    personStatus: 'unknown',
    frontDeskActive: false,
    message: 'Front desk mode disabled',
  })

  useEffect(() => {
    latestCanTriggerRef.current = canTriggerPresence
  }, [canTriggerPresence])

  useEffect(() => {
    latestOnPresenceConfirmedRef.current = onPresenceConfirmed
  }, [onPresenceConfirmed])

  useEffect(() => {
    if (!enabled) {
      debugStateRef.current = {
        cameraStatus: 'disabled',
        personStatus: 'unknown',
        frontDeskActive: false,
        message: 'Front desk mode disabled',
      }
      emitDebug(onDebugStateChange, debugStateRef.current)
      return
    }

    let cancelled = false

    const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
      if (timer) clearTimeout(timer)
    }

    const clearSimulationTimers = () => {
      simulateTimersRef.current.forEach((timer) => clearTimeout(timer))
      simulateTimersRef.current = []
    }

    const setDebugState = (next: Partial<FrontDeskDebugState>) => {
      debugStateRef.current = { ...debugStateRef.current, ...next }
      emitDebug(onDebugStateChange, debugStateRef.current)
    }

    const cleanupStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause()
          videoRef.current.srcObject = null
        } catch (error) {
          // ignore
        }
      }
    }

    const scheduleReconnect = (reason: string) => {
      if (cancelled) return

      clearTimer(reconnectTimerRef.current)
      setDebugState({
        cameraStatus: 'reconnecting',
        message: reason,
      })

      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelled) {
          void startCamera()
        }
      }, frontDeskConfig.cameraReconnectMs)
    }

    const markPersonAbsent = (message: string, emit = true) => {
      if (presenceActiveRef.current || presenceCandidateSinceRef.current !== null) {
        console.log('[Vision] Person no longer detected')
      }

      presenceActiveRef.current = false
      presenceCandidateSinceRef.current = null
      presenceSessionTriggeredRef.current = false
      presenceSessionSuppressedRef.current = false
      lastSeenAtRef.current = null

      if (emit) {
        setDebugState({
          personStatus: 'clear',
          frontDeskActive: false,
          message,
        })
      }
    }

    const evaluatePresence = (hasPerson: boolean) => {
      const now = Date.now()

      if (hasPerson) {
        lastSeenAtRef.current = now

        if (debugStateRef.current.personStatus !== 'detected') {
          console.log('[Vision] Person detected')
        }

        setDebugState({
          personStatus: 'detected',
          message: 'Person detected locally',
        })

        if (!presenceActiveRef.current) {
          if (presenceCandidateSinceRef.current === null) {
            presenceCandidateSinceRef.current = now
            return
          }

          if (now - presenceCandidateSinceRef.current < frontDeskConfig.personConfirmationMs) {
            return
          }

          presenceActiveRef.current = true
          setDebugState({
            frontDeskActive: true,
            message: 'Customer presence confirmed',
          })
          console.log('[Front Desk] Customer presence confirmed')
        }

        if (presenceActiveRef.current && !presenceSessionTriggeredRef.current && !presenceSessionSuppressedRef.current) {
          if (!latestCanTriggerRef.current()) {
            presenceSessionSuppressedRef.current = true
            return
          }

          if (now < cooldownUntilRef.current) {
            return
          }

          presenceSessionTriggeredRef.current = true
          presenceSessionSuppressedRef.current = true
          cooldownUntilRef.current = now + frontDeskConfig.greetingCooldownMs
          console.log('[Front Desk] Starting front-desk greeting')
          void latestOnPresenceConfirmedRef.current()
        }
      } else {
        presenceCandidateSinceRef.current = null

        if (!presenceActiveRef.current) {
          if (debugStateRef.current.personStatus !== 'clear') {
            setDebugState({
              personStatus: 'clear',
              message: 'No person detected',
            })
          }
          return
        }

        if (lastSeenAtRef.current && now - lastSeenAtRef.current >= frontDeskConfig.personAbsenceMs) {
          console.log('[Vision] Person no longer detected')
          markPersonAbsent('No person detected')
        }
      }
    }

    const detectFrame = async () => {
      if (cancelled || !activeRef.current) return

      const video = videoRef.current
      const model = modelRef.current
      if (!video || !model) return

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return
      }

      try {
        const predictions = await model.detect(video)
        const hasPerson = predictions.some((prediction: any) => prediction.class === 'person' && prediction.score >= frontDeskConfig.personConfidenceThreshold)
        evaluatePresence(hasPerson)
      } catch (error) {
        warn(`Detection failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const runDetectionLoop = async () => {
      while (!cancelled && activeRef.current) {
        const start = Date.now()
        await detectFrame()
        const elapsed = Date.now() - start
        await delay(Math.max(0, frontDeskConfig.detectionIntervalMs - elapsed))
      }
    }

    const startCamera = async () => {
      if (cancelled) return

      clearTimer(reconnectTimerRef.current)
      setDebugState({
        cameraStatus: frontDeskConfig.simulatePerson ? 'simulated' : 'initializing',
        message: frontDeskConfig.simulatePerson ? 'Front desk simulation enabled' : 'Initializing camera',
      })

      cleanupStream()
      modelRef.current = null
      activeRef.current = true
      clearSimulationTimers()

      if (frontDeskConfig.simulatePerson) {
        const triggerCycle = () => {
          if (cancelled) return
          setDebugState({
            cameraStatus: 'simulated',
            personStatus: 'detected',
            frontDeskActive: true,
            message: 'Simulated person detected',
          })
          console.log('[Vision] Simulated person detected')
          presenceActiveRef.current = true
          presenceSessionTriggeredRef.current = true
          presenceSessionSuppressedRef.current = true
          cooldownUntilRef.current = Date.now() + frontDeskConfig.greetingCooldownMs
          void latestOnPresenceConfirmedRef.current()

          simulateTimersRef.current.push(
            setTimeout(() => {
              if (!cancelled) {
                markPersonAbsent('Simulation cleared')
              }
            }, frontDeskConfig.personAbsenceMs)
          )

          simulateTimersRef.current.push(
            setTimeout(() => {
              if (!cancelled) {
                triggerCycle()
              }
            }, frontDeskConfig.personAbsenceMs + frontDeskConfig.greetingCooldownMs)
          )
        }

        triggerCycle()
        return
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        warn('Camera unavailable: getUserMedia is not supported')
        setDebugState({
          cameraStatus: 'unavailable',
          message: 'Camera unsupported in this browser',
        })
        scheduleReconnect('Camera unsupported in this browser')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: frontDeskConfig.cameraWidth },
            height: { ideal: frontDeskConfig.cameraHeight },
            frameRate: { ideal: 15, max: 15 },
            facingMode: 'user',
          },
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        const video = videoRef.current
        if (!video) {
          throw new Error('Video element not available')
        }

        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play().catch(() => undefined)

        const [tfModule, cocoSsdModule] = await Promise.all([import('@tensorflow/tfjs'), import('@tensorflow-models/coco-ssd')])
        await tfModule.ready()

        try {
          await tfModule.setBackend('webgl')
        } catch (error) {
          await tfModule.setBackend('cpu')
        }

        modelRef.current = await cocoSsdModule.load({
          base: 'lite_mobilenet_v2',
        })

        setDebugState({
          cameraStatus: 'connected',
          message: 'Camera initialized',
        })
        console.log('[Camera] Camera initialized')

        void runDetectionLoop()

        const track = stream.getVideoTracks()[0]
        track.onended = () => {
          if (cancelled) return
          warn('Camera track ended')
          setDebugState({
            cameraStatus: 'unavailable',
            message: 'Camera disconnected',
          })
          scheduleReconnect('Camera disconnected')
        }
      } catch (error) {
        warn(`Unable to initialize camera: ${error instanceof Error ? error.message : String(error)}`)
        setDebugState({
          cameraStatus: 'unavailable',
          message: 'Camera unavailable',
        })
        scheduleReconnect('Camera unavailable')
      }
    }

    const simulateListener = (event: Event) => {
      event.preventDefault()
      if (cancelled) return
      console.log('[Front Desk] Manual simulation requested')
      presenceActiveRef.current = true
      presenceSessionTriggeredRef.current = true
      presenceSessionSuppressedRef.current = true
      cooldownUntilRef.current = Date.now() + frontDeskConfig.greetingCooldownMs
      setDebugState({
        cameraStatus: 'simulated',
        personStatus: 'detected',
        frontDeskActive: true,
        message: 'Manual person simulation triggered',
      })
      void latestOnPresenceConfirmedRef.current()
      clearSimulationTimers()
      simulateTimersRef.current.push(
        setTimeout(() => {
          if (!cancelled) {
            markPersonAbsent('Manual simulation cleared')
          }
        }, frontDeskConfig.personAbsenceMs)
      )
    }

    const start = async () => {
      if (frontDeskConfig.simulatePerson) {
        await startCamera()
      } else {
        await startCamera()
      }
    }

    window.addEventListener('atlas-front-desk-simulate-person', simulateListener)
    void start()

    return () => {
      cancelled = true
      activeRef.current = false
      clearTimer(detectionLoopRef.current)
      clearTimer(reconnectTimerRef.current)
      clearSimulationTimers()
      window.removeEventListener('atlas-front-desk-simulate-person', simulateListener)
      cleanupStream()
      modelRef.current = null
      markPersonAbsent('Front desk detector stopped', false)
    }
  }, [enabled, onDebugStateChange])

  if (!enabled) {
    return null
  }

  return (
    <div
      aria-label="Atlas camera preview"
      style={{
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        width: '360px',
        height: '240px',
        zIndex: 998,
        borderRadius: '14px',
        overflow: 'hidden',
        background: '#0a0f14',
        border: '1px solid rgba(0, 255, 0, 0.85)',
        boxShadow: '0 14px 36px rgba(0, 0, 0, 0.38)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '0',
          left: '0',
          right: '0',
          padding: '6px 10px',
          fontSize: '11px',
          lineHeight: '1.2',
          color: '#00ff66',
          background: 'rgba(0, 0, 0, 0.72)',
          fontFamily: 'monospace',
          zIndex: 2,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}
      >
        Camera Preview
      </div>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
          display: 'block',
        }}
        aria-hidden="true"
      />
    </div>
  )
}

export default FrontDeskPresenceDetector
