/**
 * Who is allowed to read customer submissions back out of the system.
 *
 * Submissions contain customer contact details, so the endpoints the kiosk
 * polls must not be open to the internet — the entry QR code is permanent and
 * public, and anyone can reach /session. Writing a submission is public by
 * necessity; reading them back is not.
 *
 * Two ways to be authorised, checked in this order:
 *
 *  1. ATLAS_KIOSK_TOKEN is set  — the caller must present it in the
 *     `x-atlas-kiosk-token` header. This is what a kiosk talking to a remote
 *     deployment uses.
 *  2. ATLAS_KIOSK_TOKEN is not set — only loopback callers are allowed, which
 *     covers the normal setup where Atlas runs on the kiosk machine and polls
 *     its own server. Never allowed on a serverless host, where "loopback"
 *     means the platform's proxy rather than a local operator.
 *
 * Pure module: it takes everything it needs as arguments so it can be unit
 * tested without a request object.
 */

import { timingSafeEqual } from 'crypto'

export interface KioskAuthContext {
  /** Value of the x-atlas-kiosk-token header, if any. */
  token?: string | string[]
  /** The socket's remote address. */
  remoteAddress?: string
  /** The x-forwarded-for header, if the request came through a proxy. */
  forwardedFor?: string | string[]
  /** Contents of ATLAS_KIOSK_TOKEN, if configured. */
  configuredToken?: string
  /** True when running on a serverless platform such as Vercel. */
  isServerless?: boolean
}

export type KioskAuthResult =
  | { ok: true; via: 'token' | 'loopback' }
  | { ok: false; reason: string }

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

function firstValue(value?: string | string[]): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function isLoopbackAddress(address: string): boolean {
  return LOOPBACK_ADDRESSES.has(address.trim().toLowerCase())
}

/** Compares two secrets without leaking how much of the value matched. */
function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function authorizeKioskRequest(context: KioskAuthContext): KioskAuthResult {
  const configured = (context.configuredToken ?? '').trim()

  if (configured.length > 0) {
    const presented = firstValue(context.token).trim()
    if (!presented) {
      return { ok: false, reason: 'missing kiosk token' }
    }
    if (!secretsMatch(configured, presented)) {
      return { ok: false, reason: 'invalid kiosk token' }
    }
    return { ok: true, via: 'token' }
  }

  if (context.isServerless) {
    return { ok: false, reason: 'ATLAS_KIOSK_TOKEN must be set on a hosted deployment' }
  }

  // A proxied request is never treated as local, even if the socket says
  // loopback — behind a proxy that only tells us the proxy is local.
  const forwardedFor = firstValue(context.forwardedFor).trim()
  if (forwardedFor && !forwardedFor.split(',').every((hop) => isLoopbackAddress(hop))) {
    return { ok: false, reason: 'forwarded request requires a kiosk token' }
  }

  if (!isLoopbackAddress(context.remoteAddress ?? '')) {
    return { ok: false, reason: 'remote request requires a kiosk token' }
  }

  return { ok: true, via: 'loopback' }
}

/** Builds the auth context from a Next API request. */
export function kioskAuthContextFromRequest(req: {
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}): KioskAuthContext {
  return {
    token: req.headers['x-atlas-kiosk-token'],
    forwardedFor: req.headers['x-forwarded-for'],
    remoteAddress: req.socket?.remoteAddress,
    configuredToken: process.env.ATLAS_KIOSK_TOKEN,
    isServerless: Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME),
  }
}
