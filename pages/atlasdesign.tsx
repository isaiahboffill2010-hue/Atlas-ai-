import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import DesignRequestWatcher from '../components/DesignRequestWatcher'
import { readActiveRequestId } from '../lib/design-requests/active-request'
import {
  createDesignDocument,
  getSurfaces,
  isDesignComplete,
  updateSurface,
} from '../lib/design-engine/types'
import {
  applyGenerationState,
  canRetry,
  describeState,
  progressFor,
} from '../lib/design-engine/state'
import {
  startDesignGeneration,
  previewStateWalkthrough,
  registerDesignGenerator,
} from '../lib/design-engine/generator'
import { createGeminiDesignGenerator } from '../lib/design-engine/gemini-generator'
import type { DesignDocument, DesignSurface } from '../lib/design-engine/types'
import type { DesignGenerationState } from '../lib/design-engine/state'
import type { DesignGenerationHooks } from '../lib/design-engine/generator'
import type { DesignRequestRecord } from '../lib/design-requests/types'

/**
 * The Atlas design workspace.
 *
 * This is what the customer watches on the kiosk display while their design is
 * made. It shows the request Atlas has claimed, and it derives everything on
 * screen from the design document and the generation state — so a business
 * card always shows two reserved surfaces, the front and back never disagree
 * with the headline, and nothing internal (ids, statuses, errors) is shown.
 *
 * No design is generated here yet; see lib/design-engine/generator.ts for the
 * seam the Gemini engine will plug into.
 */

const POLL_INTERVAL_MS = 4000

/**
 * The design engine is registered once, here on the client. It holds no
 * credentials — it calls the server route, which is where Gemini is reached.
 */
let assetUrlListener: ((urls: Record<string, string>) => void) | null = null

registerDesignGenerator(
  createGeminiDesignGenerator({
    onAssetUrls: (urls) => assetUrlListener?.(urls),
  })
)

const colors = {
  background: '#070f18',
  panel: 'rgba(255, 255, 255, 0.035)',
  border: 'rgba(0, 168, 243, 0.22)',
  accent: '#00a8f3',
  text: '#e6eef6',
  muted: 'rgba(230, 238, 246, 0.55)',
  faint: 'rgba(230, 238, 246, 0.3)',
  danger: '#ff6b6b',
}

export default function AtlasDesignPage() {
  const router = useRouter()
  const [request, setRequest] = useState<DesignRequestRecord | null>(null)
  const [document, setDocument] = useState<DesignDocument | null>(null)
  const [state, setState] = useState<DesignGenerationState>('queued')
  const [engineConnected, setEngineConnected] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  /** Signed URLs for the customer's own assets, keyed by storage key. */
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})

  // Receives asset URLs as each surface finishes, so the customer's real QR
  // code can be laid over the generated artwork.
  useEffect(() => {
    assetUrlListener = (urls) => setAssetUrls((current) => ({ ...current, ...urls }))
    return () => {
      assetUrlListener = null
    }
  }, [])

  const abortRef = useRef<AbortController | null>(null)
  const documentRef = useRef<DesignDocument | null>(null)

  useEffect(() => {
    documentRef.current = document
  }, [document])

  const isPreviewingStates = router.query.preview === 'states'

  /** Keeps the document's surfaces in step with the state, always. */
  const goToState = useCallback((next: DesignGenerationState) => {
    setState(next)
    setDocument((current) => (current ? applyGenerationState(current, next) : current))
  }, [])

  const hooks: DesignGenerationHooks = useMemo(
    () => ({
      onState: goToState,
      onSurface: (role, patch) => {
        setDocument((current) => (current ? updateSurface(current, role, patch) : current))
      },
    }),
    [goToState]
  )

  /** Begins work on a claimed request. */
  const beginRequest = useCallback(
    async (claimed: DesignRequestRecord) => {
      abortRef.current?.abort()
      const abort = new AbortController()
      abortRef.current = abort

      const fresh = createDesignDocument(claimed)
      setRequest(claimed)
      setDocument(fresh)
      setState('queued')
      setEngineConnected(true)
      setLoadFailed(false)

      if (isPreviewingStates) {
        // A walkthrough of the states for review; it never writes artwork.
        await previewStateWalkthrough(fresh, hooks, abort.signal)
        return
      }

      const result = await startDesignGeneration(claimed, fresh, hooks, abort.signal)
      if (!abort.signal.aborted && !result.started && result.reason === 'no-generator') {
        setEngineConnected(false)
      }
    },
    [hooks, isPreviewingStates]
  )

  // Load the request Atlas is working on: the one the watcher claimed if we
  // have its id, otherwise whichever the server says is active.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      try {
        const storedId = readActiveRequestId()
        const query = storedId ? `?requestId=${encodeURIComponent(storedId)}` : ''
        const response = await fetch(`/api/design-requests/active${query}`)

        if (!response.ok) {
          if (!cancelled) setLoadFailed(response.status !== 401)
          return
        }

        const data: { request?: DesignRequestRecord | null } = await response.json()
        if (cancelled || !data.request) return

        // Already working on this one.
        if (documentRef.current?.requestId === data.request.id) return

        if (timer) clearInterval(timer)
        await beginRequest(data.request)
      } catch (error) {
        console.error('[Atlas Design] Could not load the active request:', error)
        if (!cancelled) setLoadFailed(true)
      }
    }

    load()
    timer = setInterval(load, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [beginRequest])

  const handleClaimed = useCallback(
    (claimed: DesignRequestRecord) => {
      void beginRequest(claimed)
    },
    [beginRequest]
  )

  const handleRetry = useCallback(() => {
    if (request) void beginRequest(request)
  }, [request, beginRequest])

  const copy = document ? describeState(state, document) : null
  const surfaces = document ? getSurfaces(document) : []
  const complete = document ? isDesignComplete(document) : false

  return (
    <>
      <Head>
        <title>Atlas — Creating your design</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </Head>

      {/* Reuses the existing queue and claim logic; headless here because the
          workspace already shows the customer what is happening. */}
      <DesignRequestWatcher showNotification={false} onRequestReceived={handleClaimed} />

      <main style={styles.page}>
        <header style={styles.header}>
          <div style={styles.wordmark}>ATLAS</div>
          {document && copy ? (
            <>
              <h1 style={styles.headline}>{copy.headline}</h1>
              <p style={styles.detail}>{copy.detail}</p>
            </>
          ) : (
            <>
              <h1 style={styles.headline}>Ready when you are</h1>
              <p style={styles.detail}>
                {loadFailed
                  ? 'Atlas is reconnecting. This will only take a moment.'
                  : 'Scan the code on the kiosk to send Atlas your details.'}
              </p>
            </>
          )}
        </header>

        {document && (
          <>
            {request?.business_name && (
              <div style={styles.businessName}>{request.business_name}</div>
            )}

            <section
              style={{
                ...styles.surfaces,
                // A flyer is a single tall surface; a card is two wide ones.
                maxWidth: document.type === 'flyer' ? '460px' : '1080px',
              }}
            >
              {surfaces.map((surface) => (
                <SurfacePanel key={surface.role} surface={surface} assetUrls={assetUrls} />
              ))}
            </section>

            {document.type === 'business_card' && (
              <div style={styles.chips}>
                {surfaces.map((surface) => (
                  <StatusChip key={surface.role} surface={surface} />
                ))}
              </div>
            )}

            <ProgressBar value={progressFor(state, document)} isError={state === 'error'} />

            {complete && <p style={styles.readyNote}>Both sides are finished.</p>}

            {canRetry(state) && (
              <button type="button" onClick={handleRetry} style={styles.retryButton}>
                Try again
              </button>
            )}

            {!engineConnected && state !== 'error' && (
              <p style={styles.engineNote}>
                Atlas has your details and is ready. The design step is coming next.
              </p>
            )}
          </>
        )}
      </main>

      <style>{`
        * { box-sizing: border-box; }
        html, body, #__next { margin: 0; padding: 0; background: ${colors.background}; }
        @keyframes atlas-shimmer {
          0% { background-position: -220% 0; }
          100% { background-position: 220% 0; }
        }
        @keyframes atlas-pulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.85; }
        }
      `}</style>
    </>
  )
}

/**
 * One side of the design.
 *
 * The panel is always rendered at its final size and position, whatever its
 * status, so nothing on screen moves as sides finish — the customer can see
 * from the start that a business card has two sides coming.
 */
function SurfacePanel({
  surface,
  assetUrls,
}: {
  surface: DesignSurface
  assetUrls: Record<string, string>
}) {
  const aspectRatio = `${surface.size.width} / ${surface.size.height}`

  return (
    <figure style={styles.surfaceFigure}>
      <div
        style={{
          ...styles.surfaceFrame,
          aspectRatio,
          borderColor:
            surface.status === 'error'
              ? 'rgba(255, 107, 107, 0.5)'
              : surface.status === 'complete'
              ? 'rgba(0, 168, 243, 0.55)'
              : colors.border,
        }}
      >
        <SurfaceBody surface={surface} assetUrls={assetUrls} />
      </div>
      <figcaption style={styles.surfaceCaption}>{surface.label}</figcaption>
    </figure>
  )
}

function SurfaceBody({
  surface,
  assetUrls,
}: {
  surface: DesignSurface
  assetUrls: Record<string, string>
}) {
  if (surface.status === 'error') {
    return <div style={styles.surfaceMessage}>Atlas could not finish this side.</div>
  }

  // The generated artwork is the background; the customer's own assets are laid
  // over it from their original files, positioned by their element frames. The
  // QR code is composited this way on purpose — a generated one would look
  // right and scan to nothing.
  if (surface.previewUrl) {
    return (
      <div style={styles.surfaceStage}>
        <img
          src={surface.previewUrl}
          alt={`${surface.label} of your design`}
          style={styles.surfaceImage}
        />
        {surface.content?.elements.map((element) => {
          if (element.kind !== 'image') return null

          const url = assetUrls[element.storageKey]
          if (!url) return null

          const { size } = surface.content!
          return (
            <img
              key={element.id}
              src={url}
              alt=""
              style={{
                position: 'absolute',
                left: `${(element.frame.x / size.width) * 100}%`,
                top: `${(element.frame.y / size.height) * 100}%`,
                width: `${(element.frame.width / size.width) * 100}%`,
                height: `${(element.frame.height / size.height) * 100}%`,
                objectFit: element.fit,
                zIndex: element.z,
                background: '#fff',
                borderRadius: '2px',
              }}
            />
          )
        })}
      </div>
    )
  }

  if (surface.status === 'designing') {
    return (
      <div style={styles.shimmer}>
        <div style={styles.surfaceMessage}>Creating {surface.label.toLowerCase()}…</div>
      </div>
    )
  }

  if (surface.status === 'complete') {
    return <div style={styles.surfaceMessage}>Ready</div>
  }

  return (
    <div style={{ ...styles.surfaceMessage, color: colors.faint }}>
      {surface.role === 'back' ? 'Waiting for the back' : 'Waiting to start'}
    </div>
  )
}

function StatusChip({ surface }: { surface: DesignSurface }) {
  const done = surface.status === 'complete'
  const working = surface.status === 'designing'

  return (
    <div
      style={{
        ...styles.chip,
        color: done ? colors.accent : working ? colors.text : colors.faint,
        borderColor: done ? 'rgba(0, 168, 243, 0.45)' : colors.border,
      }}
    >
      <span style={{ fontSize: '13px' }}>{done ? '✓' : working ? '◍' : '○'}</span>
      <span style={{ textTransform: 'uppercase', letterSpacing: '1.4px', fontSize: '11px' }}>
        {surface.label}
      </span>
    </div>
  )
}

function ProgressBar({ value, isError }: { value: number; isError: boolean }) {
  return (
    <div style={styles.progressTrack}>
      <div
        style={{
          ...styles.progressFill,
          width: `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`,
          background: isError ? colors.danger : colors.accent,
        }}
      />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: `radial-gradient(circle at 50% 0%, #10243a 0%, ${colors.background} 55%)`,
    color: colors.text,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 24px 64px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    textAlign: 'center',
  },
  header: {
    marginBottom: '40px',
    maxWidth: '720px',
  },
  wordmark: {
    fontSize: '13px',
    letterSpacing: '9px',
    color: colors.accent,
    marginBottom: '22px',
    fontWeight: 600,
  },
  headline: {
    fontSize: 'clamp(26px, 4vw, 42px)',
    fontWeight: 300,
    margin: '0 0 12px',
    lineHeight: 1.2,
  },
  detail: {
    fontSize: 'clamp(14px, 1.6vw, 17px)',
    color: colors.muted,
    margin: 0,
    lineHeight: 1.5,
  },
  businessName: {
    fontSize: '13px',
    letterSpacing: '2.5px',
    textTransform: 'uppercase',
    color: colors.faint,
    marginBottom: '28px',
  },
  surfaces: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 'clamp(20px, 3vw, 40px)',
    width: '100%',
  },
  surfaceFigure: {
    margin: 0,
    flex: '1 1 320px',
    maxWidth: '480px',
    minWidth: '260px',
  },
  surfaceFrame: {
    width: '100%',
    borderRadius: '14px',
    border: '1px solid',
    background: colors.panel,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
    transition: 'border-color 0.4s ease',
  },
  surfaceStage: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  surfaceImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  surfaceMessage: {
    fontSize: '13px',
    color: colors.muted,
    letterSpacing: '0.6px',
    padding: '16px',
  },
  shimmer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background:
      'linear-gradient(100deg, rgba(255,255,255,0.02) 30%, rgba(0,168,243,0.13) 50%, rgba(255,255,255,0.02) 70%)',
    backgroundSize: '220% 100%',
    animation: 'atlas-shimmer 2.1s linear infinite',
  },
  surfaceCaption: {
    marginTop: '12px',
    fontSize: '11px',
    letterSpacing: '2.4px',
    textTransform: 'uppercase',
    color: colors.faint,
  },
  chips: {
    display: 'flex',
    gap: '14px',
    justifyContent: 'center',
    marginTop: '32px',
    flexWrap: 'wrap',
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderRadius: '999px',
    border: '1px solid',
    background: 'rgba(255, 255, 255, 0.02)',
  },
  progressTrack: {
    marginTop: '30px',
    width: 'min(420px, 80vw)',
    height: '3px',
    borderRadius: '999px',
    background: 'rgba(255, 255, 255, 0.07)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.6s ease',
  },
  readyNote: {
    marginTop: '20px',
    fontSize: '14px',
    color: colors.accent,
  },
  engineNote: {
    marginTop: '22px',
    fontSize: '13px',
    color: colors.faint,
    maxWidth: '440px',
    lineHeight: 1.5,
  },
  retryButton: {
    marginTop: '26px',
    padding: '14px 32px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#04121d',
    background: colors.accent,
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
  },
}
