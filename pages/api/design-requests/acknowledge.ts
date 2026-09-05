import type { NextApiRequest, NextApiResponse } from 'next'
import { claimDesignRequest } from '../../../lib/supabase/design-requests-db'
import { isValidRequestId } from '../../../lib/design-requests/validation'
import {
  authorizeKioskRequest,
  kioskAuthContextFromRequest,
} from '../../../lib/design-requests/kiosk-auth'

/**
 * Atlas calls this to claim a submission, moving it `pending` -> `received`.
 *
 * The claim is conditional on the row still being `pending`, so a request that
 * two overlapping polls both saw is only ever handled once: the first caller
 * gets `claimed: true`, the second gets `false` and skips it.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = authorizeKioskRequest(kioskAuthContextFromRequest(req))
  if (!auth.ok) {
    console.warn(`[Design Requests Acknowledge API] Refused: ${auth.reason}`)
    return res.status(401).json({ error: 'Not authorised' })
  }

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : ''
  if (!isValidRequestId(requestId)) {
    return res.status(400).json({ error: 'Invalid request id' })
  }

  try {
    const { claimed, request } = await claimDesignRequest(requestId)
    return res.status(200).json({ claimed, request })
  } catch (error) {
    console.error('[Design Requests Acknowledge API] Error:', error)
    return res.status(500).json({ error: 'Failed to acknowledge submission' })
  }
}
