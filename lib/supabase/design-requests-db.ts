import { getSupabaseAdmin } from './client'
import { isValidRequestId } from '../design-requests/validation'
import type {
  DesignRequestInput,
  DesignRequestRecord,
  DesignRequestStatus,
} from '../design-requests/types'

/**
 * Persistence for customer design requests (`atlas_design_requests`).
 *
 * Every submission is its own row with its own id — there is no shared mutable
 * "current customer" anywhere — so several customers can submit from their
 * phones at once and simply queue up behind each other.
 *
 * Intake only: this stores what the customer sent and nothing generates a
 * design yet.
 */

/**
 * Ceiling on how many unhandled requests may pile up. The entry QR code is
 * permanent and public, so without a cap anyone could fill the table.
 */
export const MAX_PENDING_REQUESTS = 50

function log(message: string) {
  console.log(`[Design Requests DB] ${message}`)
}

export async function countPendingRequests(): Promise<number> {
  const db = getSupabaseAdmin()

  const { count, error } = await db
    .from('atlas_design_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  if (error) {
    log(`Error counting pending requests: ${error.message}`)
    throw error
  }

  return count ?? 0
}

/**
 * Inserts a validated submission.
 *
 * `id` is supplied by the caller because the uploaded files are stored under a
 * key that contains it, so the row and its storage objects share one identifier.
 */
export async function createDesignRequest(
  id: string,
  input: DesignRequestInput
): Promise<DesignRequestRecord> {
  const db = getSupabaseAdmin()

  const { data, error } = await db
    .from('atlas_design_requests')
    .insert({
      id,
      design_type: input.design_type,
      business_name: input.business_name,
      person_name: input.person_name,
      job_title: input.job_title,
      phone: input.phone,
      email: input.email,
      website: input.website,
      address: input.address,
      social_media: input.social_media,
      additional_information: input.additional_information,
      design_instructions: input.design_instructions,
      flyer_details: input.flyer_details,
      logo_file_reference: input.logo_file_reference,
      customer_qr_file_reference: input.customer_qr_file_reference,
      status: 'pending',
    })
    .select()
    .single()

  if (error || !data) {
    log(`Error creating design request: ${error?.message ?? 'no row returned'}`)
    throw error ?? new Error('Failed to create design request')
  }

  log(`Created ${input.design_type} request ${data.id}`)
  return data as DesignRequestRecord
}

/**
 * The queue the kiosk polls: unhandled requests, **oldest first**, so customers
 * are served in the order they submitted.
 */
export async function getPendingDesignRequests(limit = 10): Promise<DesignRequestRecord[]> {
  const db = getSupabaseAdmin()

  const { data, error } = await db
    .from('atlas_design_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    log(`Error fetching pending design requests: ${error.message}`)
    return []
  }

  return (data ?? []) as DesignRequestRecord[]
}

export async function getDesignRequest(requestId: string): Promise<DesignRequestRecord | null> {
  if (!isValidRequestId(requestId)) return null

  const db = getSupabaseAdmin()

  const { data, error } = await db
    .from('atlas_design_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()

  if (error) {
    log(`Error fetching design request: ${error.message}`)
    return null
  }

  return (data as DesignRequestRecord) ?? null
}

/**
 * The request Atlas is currently working on: the most recently claimed one.
 *
 * Used by the design workspace when it is opened without a specific request in
 * hand — for example when the kiosk was already showing a claimed request
 * before the workspace was opened.
 */
export async function getActiveDesignRequest(): Promise<DesignRequestRecord | null> {
  const db = getSupabaseAdmin()

  const { data, error } = await db
    .from('atlas_design_requests')
    .select('*')
    .in('status', ['received', 'processing'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    log(`Error fetching the active design request: ${error.message}`)
    return null
  }

  return (data as DesignRequestRecord) ?? null
}

/**
 * Claims a pending request for the kiosk.
 *
 * The update only matches rows that are still `pending`, so if the same request
 * is seen twice — two polls overlapping, or two kiosks running — exactly one
 * caller gets `claimed: true` and the work happens once.
 */
export async function claimDesignRequest(
  requestId: string
): Promise<{ claimed: boolean; request: DesignRequestRecord | null }> {
  if (!isValidRequestId(requestId)) {
    return { claimed: false, request: null }
  }

  const db = getSupabaseAdmin()

  const { data, error } = await db
    .from('atlas_design_requests')
    .update({ status: 'received', updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select()

  if (error) {
    log(`Error claiming request ${requestId}: ${error.message}`)
    return { claimed: false, request: null }
  }

  const rows = (data ?? []) as DesignRequestRecord[]
  if (rows.length === 0) {
    log(`Request ${requestId} was already claimed`)
    return { claimed: false, request: null }
  }

  log(`Request ${requestId} claimed -> received`)
  return { claimed: true, request: rows[0] }
}

/** Moves a request along the lifecycle. Used by the later generation phases. */
export async function updateDesignRequestStatus(
  requestId: string,
  status: DesignRequestStatus
): Promise<boolean> {
  if (!isValidRequestId(requestId)) return false

  const db = getSupabaseAdmin()

  const { error } = await db
    .from('atlas_design_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', requestId)

  if (error) {
    log(`Error updating request status: ${error.message}`)
    return false
  }

  log(`Request ${requestId} -> ${status}`)
  return true
}
