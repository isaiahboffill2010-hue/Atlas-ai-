/**
 * Customer design requests — intake only (no design generation yet).
 *
 * A customer scans the permanent QR code printed on the Atlas kiosk, which
 * always points at /session. They fill in the form on their phone and submit.
 * The backend gives each submission its own id and stores it as its own row, so
 * customers queue up behind each other rather than overwriting one another.
 *
 * NOTE ON THE TWO QR CODES — they are deliberately kept apart:
 *   1. The *kiosk entry QR* is physical, permanent, and created outside this
 *      app. It encodes nothing but the /session URL. The app never generates
 *      it and never stores it.
 *   2. The *customer QR code* is an image the customer uploads to be printed on
 *      their card/flyer. It lives in `customer_qr_file_reference`.
 */

export const DESIGN_TYPES = ['business_card', 'flyer'] as const
export type DesignType = (typeof DESIGN_TYPES)[number]

/**
 * Lifecycle: a submission arrives `pending`, becomes `received` the moment the
 * kiosk picks it up, and the later phases move it on to `processing` /
 * `completed` / `failed` once Gemini generation exists.
 */
export const DESIGN_REQUEST_STATUSES = [
  'pending',
  'received',
  'processing',
  'completed',
  'failed',
] as const
export type DesignRequestStatus = (typeof DESIGN_REQUEST_STATUSES)[number]

/** Fields that only make sense on a flyer, kept out of the business-card columns. */
export interface FlyerDetails {
  main_title: string | null
  description: string | null
}

/** Contact/company information shared by both design types. */
export interface DesignRequestFields {
  business_name: string
  person_name: string | null
  job_title: string | null
  phone: string | null
  email: string | null
  website: string | null
  address: string | null
  social_media: string | null
  additional_information: string | null
  design_instructions: string | null
}

/** A validated submission, ready to be written to the database. */
export interface DesignRequestInput extends DesignRequestFields {
  design_type: DesignType
  flyer_details: FlyerDetails | null
  logo_file_reference: string | null
  customer_qr_file_reference: string | null
}

/** A row of `atlas_design_requests`. */
export interface DesignRequestRecord extends DesignRequestInput {
  id: string
  status: DesignRequestStatus
  created_at: string
  updated_at: string
}

/** The two kinds of image a customer can attach, used to name the storage key. */
export const UPLOAD_KINDS = ['logo', 'customer_qr'] as const
export type UploadKind = (typeof UPLOAD_KINDS)[number]

export function isDesignType(value: unknown): value is DesignType {
  return typeof value === 'string' && (DESIGN_TYPES as readonly string[]).includes(value)
}

export function isDesignRequestStatus(value: unknown): value is DesignRequestStatus {
  return (
    typeof value === 'string' && (DESIGN_REQUEST_STATUSES as readonly string[]).includes(value)
  )
}
