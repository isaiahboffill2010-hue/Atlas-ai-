import type { NextApiRequest, NextApiResponse } from 'next'
import Busboy from 'busboy'
import { randomUUID } from 'crypto'
import {
  createDesignRequest,
  countPendingRequests,
  MAX_PENDING_REQUESTS,
} from '../../../lib/supabase/design-requests-db'
import { uploadDesignAssetToStorage, deleteFileFromStorage } from '../../../lib/supabase/storage'
import { validateSubmission } from '../../../lib/design-requests/validation'
import {
  validateImageUpload,
  buildUploadStorageKey,
  MAX_UPLOAD_BYTES,
  MAX_REQUEST_BYTES,
} from '../../../lib/design-requests/upload-validation'
import type { UploadKind } from '../../../lib/design-requests/types'

/**
 * Customer submission endpoint — intake only.
 *
 * Receives the multipart form from /session: the typed design type, the
 * business information, the customer's own description of the design, and
 * optionally two images (their logo and the QR code they want printed).
 *
 * There is no session id. The server mints the request id, so a customer
 * cannot direct their submission at anything but a fresh row of their own, and
 * concurrent customers can never overwrite each other.
 *
 * Everything is re-validated here; the page's checks are for UX only. Errors
 * returned to the customer are plain language — no storage paths, SQL, or
 * Supabase details ever reach the browser.
 */

export const config = {
  api: {
    bodyParser: false,
  },
}

/** Text fields accepted from the form. Anything else is discarded. */
const ALLOWED_FIELDS = new Set([
  'design_type',
  'business_name',
  'person_name',
  'job_title',
  'phone',
  'email',
  'website',
  'address',
  'social_media',
  'additional_information',
  'design_instructions',
  'main_title',
  'description',
])

/**
 * File fields accepted from the form. Both are optional.
 *
 * `logo`        — the customer's business logo.
 * `customer_qr` — the QR code the CUSTOMER wants printed on their design. This
 *                 is unrelated to the permanent QR code on the kiosk, which is
 *                 physical, encodes only the /session URL, and is never stored.
 */
const UPLOAD_FIELDS: Record<string, UploadKind> = {
  logo: 'logo',
  customer_qr: 'customer_qr',
}

const GENERIC_ERROR = 'Something went wrong. Please try again.'

interface ParsedUpload {
  kind: UploadKind
  filename?: string
  mimeType?: string
  data: Buffer
  truncated: boolean
}

interface ParsedForm {
  fields: Record<string, string>
  uploads: ParsedUpload[]
  tooManyFiles: boolean
}

function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 2,
        fields: 25,
        fieldSize: 8 * 1024,
        parts: 30,
      },
    })

    const fields: Record<string, string> = {}
    const uploads: ParsedUpload[] = []
    let tooManyFiles = false

    bb.on('field', (name: string, value: string) => {
      if (ALLOWED_FIELDS.has(name)) {
        fields[name] = value
      }
    })

    bb.on('file', (name: string, stream: NodeJS.ReadableStream, info: any) => {
      const kind = UPLOAD_FIELDS[name]
      if (!kind) {
        console.warn(`[Submit API] Ignoring unexpected file field: ${name}`)
        stream.resume()
        return
      }

      const chunks: Buffer[] = []
      let truncated = false

      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('limit', () => {
        truncated = true
      })
      stream.on('error', reject)
      stream.on('end', () => {
        uploads.push({
          kind,
          filename: typeof info?.filename === 'string' ? info.filename : undefined,
          mimeType: typeof info?.mimeType === 'string' ? info.mimeType : undefined,
          data: Buffer.concat(chunks),
          truncated,
        })
      })
    })

    bb.on('filesLimit', () => {
      tooManyFiles = true
    })

    bb.on('close', () => resolve({ fields, uploads, tooManyFiles }))
    bb.on('error', reject)

    req.pipe(bb)
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Cheap rejection of oversized requests before anything is buffered.
  const declaredLength = Number(req.headers['content-length'] ?? 0)
  if (declaredLength > MAX_REQUEST_BYTES) {
    return res.status(413).json({ error: 'Those files are too large. Please use smaller images.' })
  }

  const uploadedKeys: string[] = []

  try {
    const { fields, uploads, tooManyFiles } = await parseForm(req)

    if (tooManyFiles) {
      return res.status(400).json({ error: 'Only a logo and a QR code can be attached.' })
    }

    // 1. Validate the typed fields.
    const validation = validateSubmission(fields)
    if (!validation.ok) {
      return res.status(400).json({
        error: 'Please check the highlighted fields.',
        fieldErrors: validation.fieldErrors,
      })
    }

    // 2. Keep the queue from being flooded through the public entry point.
    const pending = await countPendingRequests()
    if (pending >= MAX_PENDING_REQUESTS) {
      return res
        .status(429)
        .json({ error: 'Atlas is busy right now. Please try again in a moment.' })
    }

    // 3. Validate the uploads by content, not by what the browser claimed. Both
    //    images are optional, so an untouched file input is simply skipped.
    const requestId = randomUUID()
    const references: Partial<Record<UploadKind, string>> = {}
    const seen = new Set<UploadKind>()

    for (const upload of uploads) {
      if (upload.data.length === 0 && !upload.truncated) {
        continue
      }

      if (seen.has(upload.kind)) {
        return res.status(400).json({ error: 'Please attach one image per slot.' })
      }
      seen.add(upload.kind)

      const check = validateImageUpload(upload.data, {
        filename: upload.filename,
        mimeType: upload.mimeType,
        truncated: upload.truncated,
      })

      if (!check.ok) {
        const label = upload.kind === 'logo' ? 'Logo' : 'QR code'
        return res.status(400).json({ error: `${label}: ${check.error}` })
      }

      const storageKey = buildUploadStorageKey(requestId, upload.kind, check.format)
      await uploadDesignAssetToStorage(storageKey, upload.data, check.format.mimeType)
      uploadedKeys.push(storageKey)
      references[upload.kind] = storageKey
    }

    // 4. Persist the submission as its own row.
    await createDesignRequest(requestId, {
      ...validation.value,
      logo_file_reference: references.logo ?? null,
      customer_qr_file_reference: references.customer_qr ?? null,
    })

    console.log(`[Submit API] Stored ${validation.value.design_type} request ${requestId}`)

    // The customer is told it worked and nothing else — no request id, no
    // storage keys, no database detail.
    return res.status(201).json({
      success: true,
      message: 'Atlas has received your information. Your design is being prepared.',
    })
  } catch (error) {
    console.error('[Submit API] Error:', error)

    // Don't leave orphaned objects in storage if the insert failed.
    for (const key of uploadedKeys) {
      await deleteFileFromStorage(key).catch((cleanupError) => {
        console.error('[Submit API] Failed to clean up storage object:', cleanupError)
      })
    }

    return res.status(500).json({ error: GENERIC_ERROR })
  }
}
