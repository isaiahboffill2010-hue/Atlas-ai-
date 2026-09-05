import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getActiveDesignRequest,
  getDesignRequest,
} from '../../../lib/supabase/design-requests-db'
import { isValidRequestId } from '../../../lib/design-requests/validation'
import {
  authorizeKioskRequest,
  kioskAuthContextFromRequest,
} from '../../../lib/design-requests/kiosk-auth'

/**
 * Loads the design request the workspace should be showing.
 *
 * With `?requestId=` it returns that specific request — the id the watcher
 * recorded when it claimed one. Without it, it returns whichever request Atlas
 * most recently claimed, so opening /atlasdesign directly still lands on the
 * right customer.
 *
 * This only reads; claiming stays with the existing watcher and queue. It is
 * behind the same kiosk authorisation as the rest of the read endpoints
 * because the record contains the customer's contact details.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = authorizeKioskRequest(kioskAuthContextFromRequest(req))
  if (!auth.ok) {
    console.warn(`[Active Design Request API] Refused: ${auth.reason}`)
    return res.status(401).json({ error: 'Not authorised' })
  }

  const requestedId = typeof req.query.requestId === 'string' ? req.query.requestId : ''

  try {
    const request =
      requestedId && isValidRequestId(requestedId)
        ? await getDesignRequest(requestedId)
        : await getActiveDesignRequest()

    return res.status(200).json({ request: request ?? null })
  } catch (error) {
    console.error('[Active Design Request API] Error:', error)
    return res.status(500).json({ error: 'Failed to load the design request' })
  }
}
