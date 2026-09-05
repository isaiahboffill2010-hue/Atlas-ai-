import React, { useEffect, useRef, useState } from 'react'
import { rememberActiveRequestId } from '../lib/design-requests/active-request'
import type { DesignRequestRecord } from '../lib/design-requests/types'

/**
 * Watches for customer design requests arriving from the /session form.
 *
 * Polling, not WebSockets: this is one kiosk browser checking a cheap endpoint
 * every few seconds, and the app has no realtime transport of its own.
 *
 * Each pending request is claimed before it is announced — the server only lets
 * one caller move a row out of `pending` — so a request is never handled twice,
 * and requests are worked through oldest first so customers are served in the
 * order they submitted.
 *
 * Received requests are also published on `window.atlasDesignRequests`,
 * matching the existing `window.atlasMusic` convention, so the later design
 * generation phase can read them without this component changing shape.
 */

const POLL_INTERVAL_MS = 4000

interface DesignRequestWatcherProps {
  /** Called once per request, after it has been successfully claimed. */
  onRequestReceived?: (request: DesignRequestRecord) => void
  /**
   * Whether to draw the small "information received" card. The design
   * workspace runs the watcher headless, because the workspace itself is
   * already showing the customer what is happening.
   */
  showNotification?: boolean
}

export const DesignRequestWatcher: React.FC<DesignRequestWatcherProps> = ({
  onRequestReceived,
  showNotification = true,
}) => {
  const [latest, setLatest] = useState<DesignRequestRecord | null>(null)

  const receivedRef = useRef<DesignRequestRecord[]>([])
  const inFlightRef = useRef(false)
  const onRequestReceivedRef = useRef(onRequestReceived)

  useEffect(() => {
    onRequestReceivedRef.current = onRequestReceived
  }, [onRequestReceived])

  useEffect(() => {
    let cancelled = false

    const publish = (requests: DesignRequestRecord[]) => {
      receivedRef.current = requests
      ;(window as any).atlasDesignRequests = {
        getAll: () => receivedRef.current,
        getLatest: () => receivedRef.current[0] ?? null,
      }
    }

    publish([])

    const poll = async () => {
      // Never let two polls overlap: a slow claim would otherwise be raced by
      // the next tick.
      if (inFlightRef.current) return
      inFlightRef.current = true

      try {
        const response = await fetch('/api/design-requests')
        if (!response.ok) return

        const data: { requests?: DesignRequestRecord[] } = await response.json()
        if (cancelled || !data.requests || data.requests.length === 0) return

        // The endpoint returns oldest first; work through them in that order.
        for (const pending of data.requests) {
          if (cancelled) return

          const claimResponse = await fetch('/api/design-requests/acknowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: pending.id }),
          })

          if (!claimResponse.ok) continue

          const claim: { claimed?: boolean; request?: DesignRequestRecord } =
            await claimResponse.json()

          // Someone else already took it — skip rather than announce it twice.
          if (!claim.claimed || !claim.request) continue

          const request = claim.request
          console.log(
            `[Design Requests] Customer information received: ${request.design_type} for "${request.business_name}"`
          )

          // Hand the claimed request to the design workspace by id.
          rememberActiveRequestId(request.id)

          publish([request, ...receivedRef.current])
          setLatest(request)
          onRequestReceivedRef.current?.(request)
        }
      } catch (pollError) {
        console.error('[Design Requests] Poll failed:', pollError)
      } finally {
        inFlightRef.current = false
      }
    }

    poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  // Nothing is drawn on the kiosk until a request actually arrives.
  if (!latest || !showNotification) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        maxWidth: '260px',
        background: 'rgba(10, 20, 32, 0.95)',
        border: '1px solid rgba(0, 168, 243, 0.3)',
        borderRadius: '12px',
        padding: '14px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        zIndex: 900,
        color: '#e6eef6',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        lineHeight: 1.4,
      }}
    >
      <div style={{ color: '#00a8f3', fontSize: '11px', letterSpacing: '1px', marginBottom: '6px' }}>
        INFORMATION RECEIVED
      </div>
      <div>
        {latest.design_type === 'flyer' ? 'Flyer' : 'Business card'} for{' '}
        <strong>{latest.business_name}</strong>
      </div>
    </div>
  )
}

export default DesignRequestWatcher
