/**
 * Turns a customer's design request into the instructions the image model gets.
 *
 * Pure and dependency-free so the wording can be unit tested — the prompt is
 * the part of the design engine most likely to drift, and the rules it has to
 * enforce (it is a business card, not a poster; never draw a QR code) are
 * exactly the things worth pinning down in tests.
 */

import { BUSINESS_CARD_SIZE, FLYER_SIZE } from './types'
import type { SurfaceRole, DesignFrame, SurfaceSize } from './types'
import type { DesignRequestRecord } from '../design-requests/types'

/**
 * Aspect ratios the image API accepts: 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4,
 * 9:16, 16:9, 21:9 (verified against the live API).
 *
 * A business card is 3.5 x 2in — a ratio of 1.75. The closest available is
 * 16:9 (1.778); 3:2 (1.5) is noticeably too square. The small difference is
 * trimmed when the print-ready file is produced in a later phase.
 */
export const BUSINESS_CARD_ASPECT_RATIO = '16:9'

/** A4 is 1:1.414; 3:4 (1:1.333) is the closest the API offers. */
export const FLYER_ASPECT_RATIO = '3:4'

export function aspectRatioFor(role: SurfaceRole): string {
  return role === 'flyer' ? FLYER_ASPECT_RATIO : BUSINESS_CARD_ASPECT_RATIO
}

export function surfaceSizeFor(role: SurfaceRole): SurfaceSize {
  return role === 'flyer' ? FLYER_SIZE : BUSINESS_CARD_SIZE
}

/**
 * The area kept clear for the customer's own QR code.
 *
 * The real QR image is composited into this frame afterwards. It is never
 * drawn by the model: a generated QR code would look right and scan to
 * nothing, which is worse than no QR code at all.
 */
export function reservedQrFrame(role: SurfaceRole): DesignFrame {
  const size = surfaceSizeFor(role)

  if (role === 'flyer') {
    const side = 38
    const margin = 14
    return { x: size.width - margin - side, y: size.height - margin - side, width: side, height: side }
  }

  const side = 14
  const margin = 5
  return { x: size.width - margin - side, y: size.height - margin - side, width: side, height: side }
}

/** Human-readable "keep this corner clear" wording for the prompt. */
function describeReservedArea(role: SurfaceRole): string {
  const size = surfaceSizeFor(role)
  const frame = reservedQrFrame(role)
  const widthPercent = Math.round((frame.width / size.width) * 100)

  return (
    `Leave the bottom-right corner completely clear and uncluttered — an area about ` +
    `${widthPercent}% of the width, with a plain, flat, low-detail background and no text, ` +
    `no logo and no graphics inside it. The customer's own QR code will be placed there ` +
    `afterwards. Do NOT draw a QR code, barcode, matrix code or any square pixel pattern ` +
    `anywhere in the design.`
  )
}

/** The contact lines that belong on the design, skipping anything not supplied. */
export function contactLines(request: DesignRequestRecord): string[] {
  const lines: string[] = []
  const add = (label: string, value: string | null) => {
    if (value && value.trim().length > 0) lines.push(`${label}: ${value.trim()}`)
  }

  add('Business name', request.business_name)
  add('Person', request.person_name)
  add('Job title', request.job_title)
  add('Phone', request.phone)
  add('Email', request.email)
  add('Website', request.website)
  add('Address', request.address)
  add('Social media', request.social_media)

  return lines
}

/**
 * The contact lines are given as "Label: value" so the model knows what each
 * value is. Without this the labels get set in type on the card, which reads as
 * a form rather than a business card.
 */
const LABEL_RULE =
  'The labels before each colon above (Business name, Person, Job title, Phone, Email, ' +
  'Website, Address, Social media) tell you what each value is — they are for your reference ' +
  'only. Do not print those labels on the design. Set the values themselves, arranged and ' +
  'styled so each one is obvious at a glance, using small icons or typographic hierarchy ' +
  'rather than written labels.'

/**
 * Framing is stated first and in the strongest terms.
 *
 * Left to itself the model will sometimes render a picture *of* a card sitting
 * on a white surface rather than the card artwork itself. That looks fine on
 * screen and prints as a small card floating in a white border, so it has to be
 * ruled out explicitly and early.
 */
const FRAMING_RULE =
  'CRITICAL: the artwork itself must fill the entire image, edge to edge, with full bleed. ' +
  'The image IS the printed surface — not a picture of it. There must be no white or ' +
  'coloured margin, no page background, no rounded corners, no drop shadow, no card floating ' +
  'on a surface, no mockup, no photograph, no hand, no desk, no perspective, no 3D render and ' +
  'no reflection. Every one of the four edges of the image must be the design itself, bleeding ' +
  'off the edge.'

const BASE_RULES = [
  'Render all text crisply and legibly, spelled exactly as given, with comfortable margins inside the design.',
  'Do not invent contact details, names, slogans or website addresses that were not provided.',
  'Do not add placeholder or lorem ipsum text.',
  'No watermarks, captions, borders or decorative frames around the outside of the artwork.',
]

export interface SurfacePromptOptions {
  request: DesignRequestRecord
  role: SurfaceRole
  /** True when the customer's QR code will be composited onto this surface. */
  reserveQrArea: boolean
  /** True when the customer's logo is supplied as a reference image. */
  hasLogoReference: boolean
}

/**
 * Builds the instruction text for one surface.
 *
 * The front carries the identity and the primary contact details; the back is
 * the quieter, supporting side. Both are explicitly described as one side of a
 * business card so the model cannot drift into a poster or a social post.
 */
export function buildSurfacePrompt(options: SurfacePromptOptions): string {
  const { request, role, reserveQrArea, hasLogoReference } = options
  const size = surfaceSizeFor(role)
  const instructions = request.design_instructions?.trim()

  const sections: string[] = []

  if (role === 'flyer') {
    sections.push(
      `Design a single-sided promotional FLYER, portrait orientation, ` +
        `${size.width}mm x ${size.height}mm (A4 proportions).`
    )
  } else {
    const side = role === 'front' ? 'FRONT' : 'BACK'
    sections.push(
      `Design the ${side} of a professional BUSINESS CARD. ` +
        `Standard business card proportions, landscape orientation, ` +
        `${size.width}mm x ${size.height}mm (3.5 x 2 inches). ` +
        `This is one side of a physical printed business card — not a poster, ` +
        `flyer, banner, social media post, phone wallpaper or square graphic.`
    )
  }

  sections.push(FRAMING_RULE)

  if (instructions) {
    sections.push(
      `The customer described the look they want, in their own words. Treat this as the ` +
        `primary creative direction:\n"""\n${instructions}\n"""`
    )
  } else {
    sections.push(
      'The customer gave no style notes, so use a clean, modern, professional treatment.'
    )
  }

  if (role === 'flyer') {
    const title = request.flyer_details?.main_title?.trim()
    const description = request.flyer_details?.description?.trim()

    if (title) sections.push(`Main headline, set large and prominent: "${title}"`)
    if (description) sections.push(`Supporting details to lay out clearly:\n"""\n${description}\n"""`)
    sections.push(`Include these details:\n${contactLines(request).join('\n')}`)
  } else if (role === 'front') {
    const primary = contactLines(request).filter(
      (line) =>
        line.startsWith('Business name') ||
        line.startsWith('Person') ||
        line.startsWith('Job title') ||
        line.startsWith('Phone') ||
        line.startsWith('Email')
    )
    sections.push(
      `The front is the identity side. Lead with the business name, and include only:\n` +
        `${primary.join('\n')}\n` +
        `Keep it uncrowded — leave the remaining details for the back.`
    )
  } else {
    const secondary = contactLines(request).filter(
      (line) =>
        line.startsWith('Business name') ||
        line.startsWith('Website') ||
        line.startsWith('Address') ||
        line.startsWith('Social media') ||
        line.startsWith('Phone') ||
        line.startsWith('Email')
    )
    sections.push(
      `The back is the supporting side. It must clearly belong to the same card as the ` +
        `front: the same colour palette, typography and visual style, but a calmer, more ` +
        `open composition. Include:\n${secondary.join('\n')}`
    )
  }

  sections.push(LABEL_RULE)

  if (request.additional_information?.trim()) {
    sections.push(
      `Additional notes from the customer:\n"""\n${request.additional_information.trim()}\n"""`
    )
  }

  if (hasLogoReference) {
    sections.push(
      `The attached image is the customer's own logo. Reproduce it faithfully — do not ` +
        `redraw, restyle, recolour or reinterpret it — and build the palette around it.`
    )
  }

  if (reserveQrArea) {
    sections.push(describeReservedArea(role))
  } else {
    sections.push(
      'Do NOT draw a QR code, barcode, matrix code or any square pixel pattern anywhere in the design.'
    )
  }

  sections.push(BASE_RULES.join(' '))

  return sections.join('\n\n')
}

/**
 * Which surface the customer's QR code belongs on.
 *
 * On a business card the back is the conventional home for it, and it keeps the
 * front — the identity side — clean.
 */
export function qrSurfaceFor(designType: DesignRequestRecord['design_type']): SurfaceRole {
  return designType === 'flyer' ? 'flyer' : 'back'
}
