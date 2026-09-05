import type { NextApiRequest, NextApiResponse } from 'next'
import { getDesignRequest } from '../../../lib/supabase/design-requests-db'
import {
  uploadDesignAssetToStorage,
  getFileFromStorage,
  createSignedStorageUrl,
} from '../../../lib/supabase/storage'
import {
  buildGeneratedStorageKey,
  validateGeneratedImage,
  validateImageUpload,
} from '../../../lib/design-requests/upload-validation'
import { isValidRequestId } from '../../../lib/design-requests/validation'
import {
  authorizeKioskRequest,
  kioskAuthContextFromRequest,
} from '../../../lib/design-requests/kiosk-auth'
import { generateSurfaceImage, getDesignModel } from '../../../lib/design-engine/gemini-image'
import {
  buildSurfacePrompt,
  aspectRatioFor,
  surfaceSizeFor,
  reservedQrFrame,
  qrSurfaceFor,
} from '../../../lib/design-engine/prompt'
import type { SurfaceRole, SurfaceContent, DesignElement } from '../../../lib/design-engine/types'

/**
 * Generates one surface of a design.
 *
 * All Gemini work happens here, on the server: the API key is never sent to the
 * browser, and the only images handed to the model are bytes read back out of
 * our own storage — never a URL from the request.
 *
 * The route deliberately does one surface per call. The workspace drives the
 * order (front, then back) through the existing state machine, so progress
 * appears as each side finishes instead of after a long silence.
 */

const VALID_ROLES: SurfaceRole[] = ['front', 'back', 'flyer']

/** Generous cap on what we will store as a generated design. */
const MAX_GENERATED_BYTES = 25 * 1024 * 1024

export const config = {
  api: {
    responseLimit: false,
    // Image generation is slow; give it room on platforms that honour this.
    externalResolver: true,
  },
}

interface GenerateResponse {
  storageKey: string
  previewUrl: string | null
  content: SurfaceContent
  /** Signed URLs for any customer asset the surface references, by storage key. */
  assetUrls: Record<string, string>
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GenerateResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = authorizeKioskRequest(kioskAuthContextFromRequest(req))
  if (!auth.ok) {
    console.warn(`[Design Generate API] Refused: ${auth.reason}`)
    return res.status(401).json({ error: 'Not authorised' })
  }

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : ''
  const role = typeof req.body?.role === 'string' ? (req.body.role as SurfaceRole) : null
  const attempt = Number.isInteger(req.body?.attempt) ? Number(req.body.attempt) : 1

  if (!isValidRequestId(requestId) || !role || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid design request' })
  }

  try {
    const request = await getDesignRequest(requestId)
    if (!request) {
      return res.status(404).json({ error: 'Design request not found' })
    }

    // The surface has to belong to the design type: a flyer has no back, and a
    // business card has no "flyer" surface.
    const expectedRoles: SurfaceRole[] =
      request.design_type === 'flyer' ? ['flyer'] : ['front', 'back']
    if (!expectedRoles.includes(role)) {
      return res.status(400).json({ error: 'That surface does not belong to this design' })
    }

    // The customer's logo goes to the model as a reference so the design is
    // built around it. It is re-validated on the way out of storage rather than
    // trusted just because we stored it earlier.
    const references = []
    if (request.logo_file_reference) {
      try {
        const logo = await getFileFromStorage(request.logo_file_reference)
        const check = validateImageUpload(logo)
        if (check.ok) {
          references.push({ mimeType: check.format.mimeType, data: logo })
        } else {
          console.warn(`[Design Generate API] Skipping unusable logo: ${check.error}`)
        }
      } catch (logoError) {
        console.warn('[Design Generate API] Could not read the logo:', logoError)
      }
    }

    // The customer's QR code is never generated — space is reserved for it and
    // the original file is composited in.
    const qrRole = qrSurfaceFor(request.design_type)
    const reserveQrArea = Boolean(request.customer_qr_file_reference) && role === qrRole

    const prompt = buildSurfacePrompt({
      request,
      role,
      reserveQrArea,
      hasLogoReference: references.length > 0,
    })

    console.log(
      `[Design Generate API] ${getDesignModel()} -> request ${requestId} ${role} ` +
        `(logo reference: ${references.length > 0}, QR area reserved: ${reserveQrArea})`
    )

    const generated = await generateSurfaceImage({
      prompt,
      aspectRatio: aspectRatioFor(role),
      references,
    })

    if (generated.data.length > MAX_GENERATED_BYTES) {
      throw new Error('Generated design exceeded the size limit')
    }

    const check = validateGeneratedImage(generated.data, generated.mimeType)
    if (!check.ok) {
      throw new Error(`Generated design failed validation: ${check.error}`)
    }

    const storageKey = buildGeneratedStorageKey(requestId, role, check.format, attempt)
    await uploadDesignAssetToStorage(storageKey, generated.data, check.format.mimeType)

    // The structured document: the generated artwork is the surface background,
    // and the customer's own assets stay as separate elements holding their
    // original storage keys, so later phases can move or resize them.
    const elements: DesignElement[] = []
    const assetUrls: Record<string, string> = {}

    if (reserveQrArea && request.customer_qr_file_reference) {
      elements.push({
        kind: 'image',
        id: 'customer-qr',
        source: 'customer_qr',
        storageKey: request.customer_qr_file_reference,
        fit: 'contain',
        frame: reservedQrFrame(role),
        rotation: 0,
        z: 10,
      })

      const qrUrl = await createSignedStorageUrl(request.customer_qr_file_reference)
      if (qrUrl) assetUrls[request.customer_qr_file_reference] = qrUrl
    }

    if (request.logo_file_reference) {
      // Recorded so a later phase can composite the exact original logo; it is
      // not overlaid now because the model was asked to integrate it.
      const logoUrl = await createSignedStorageUrl(request.logo_file_reference)
      if (logoUrl) assetUrls[request.logo_file_reference] = logoUrl
    }

    const content: SurfaceContent = {
      size: surfaceSizeFor(role),
      background: { kind: 'image', storageKey, fit: 'cover' },
      elements,
    }

    const previewUrl = await createSignedStorageUrl(storageKey)

    console.log(`[Design Generate API] Stored ${role} for request ${requestId} at ${storageKey}`)

    return res.status(200).json({ storageKey, previewUrl, content, assetUrls })
  } catch (error) {
    // Full detail server-side; the customer only ever sees the friendly state.
    console.error('[Design Generate API] Generation failed:', error)
    return res.status(502).json({ error: 'Design generation failed' })
  }
}
