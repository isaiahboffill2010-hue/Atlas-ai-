import type { NextApiRequest, NextApiResponse } from 'next'
import { getPendingDesignRequests } from '../../../lib/supabase/design-requests-db'
import {
  authorizeKioskRequest,
  kioskAuthContextFromRequest,
} from '../../../lib/design-requests/kiosk-auth'

/**
 * The queue the Atlas kiosk polls to find out that a customer has submitted.
 *
 * Returns unhandled requests oldest first. Polling was chosen over a new
 * realtime transport: this is one browser checking a cheap endpoint every few
 * seconds, and the app has no WebSocket infrastructure of its own.
 *
 * Reading is restricted (see kiosk-auth) because these rows contain customer
 * contact details and the entry point that creates them is public.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = authorizeKioskRequest(kioskAuthContextFromRequest(req))
  if (!auth.ok) {
    console.warn(`[Design Requests API] Refused poll: ${auth.reason}`)
    return res.status(401).json({ error: 'Not authorised' })
  }

  try {
    const requests = await getPendingDesignRequests()
    return res.status(200).json({ requests })
  } catch (error) {
    console.error('[Design Requests API] Error:', error)
    return res.status(500).json({ error: 'Failed to load design requests' })
  }
}
