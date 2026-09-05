/**
 * The Atlas design model.
 *
 * Two rules shape everything here:
 *
 *  1. A business card has a FRONT and a BACK, always. They are separate
 *     surfaces on the type, so a business card cannot even be constructed with
 *     one side, and completeness is only ever computed from both. There is
 *     deliberately no single `image` field that stands in for a whole card.
 *
 *  2. A design is structured, not a flattened picture. Each surface holds a
 *     background plus positioned elements, so later phases can act on requests
 *     like "make the logo bigger", "move the QR code" or "change the colours"
 *     by editing an element rather than regenerating a JPEG.
 *
 * Nothing in this module generates anything — it is the shape the future
 * Gemini design engine will fill in.
 */

import type { DesignRequestRecord, DesignType } from '../design-requests/types'

/**
 * Which face of a design a surface is.
 *
 * `front`/`back` belong to business cards; `flyer` is the single surface of a
 * flyer. Flyers are never forced into the front/back model.
 */
export type SurfaceRole = 'front' | 'back' | 'flyer'

export type SurfaceStatus = 'pending' | 'designing' | 'complete' | 'error'

/** Which piece of the customer's submission an element came from. */
export type DesignFieldSource =
  | 'business_name'
  | 'person_name'
  | 'job_title'
  | 'phone'
  | 'email'
  | 'website'
  | 'address'
  | 'social_media'
  | 'main_title'
  | 'description'
  | 'additional_information'
  | 'logo'
  | 'customer_qr'

export interface DesignFrame {
  /** Millimetres from the surface's top-left corner. */
  x: number
  y: number
  width: number
  height: number
}

export interface TextStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight?: number
  letterSpacing?: number
  italic?: boolean
  uppercase?: boolean
}

interface DesignElementBase {
  id: string
  frame: DesignFrame
  rotation: number
  /** Stacking order within the surface; higher paints later. */
  z: number
  /**
   * Where this element came from, so a later instruction such as "make the
   * logo bigger" can find the right element without guessing.
   */
  source?: DesignFieldSource
}

export interface TextElement extends DesignElementBase {
  kind: 'text'
  text: string
  style: TextStyle
}

export interface ImageElement extends DesignElementBase {
  kind: 'image'
  /** Supabase storage key, e.g. design-requests/<requestId>/logo.png */
  storageKey: string
  fit: 'cover' | 'contain'
}

export interface ShapeElement extends DesignElementBase {
  kind: 'shape'
  shape: 'rectangle' | 'ellipse' | 'line'
  fill?: string
  stroke?: string
  strokeWidth?: number
  cornerRadius?: number
}

export type DesignElement = TextElement | ImageElement | ShapeElement

export type DesignBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'image'; storageKey: string; fit: 'cover' | 'contain' }

/** Physical print size in millimetres. */
export interface SurfaceSize {
  width: number
  height: number
}

/**
 * The editable content of one surface. Null on a surface until the design
 * engine produces it — a surface with `content: null` has nothing to show.
 */
export interface SurfaceContent {
  size: SurfaceSize
  background: DesignBackground
  elements: DesignElement[]
}

export interface DesignSurface {
  role: SurfaceRole
  /** Customer-facing name, e.g. "Front". Never an internal state name. */
  label: string
  status: SurfaceStatus
  size: SurfaceSize
  content: SurfaceContent | null
  /**
   * Optional flattened image, for display only. The structured `content`
   * remains the source of truth so the design stays editable.
   */
  previewUrl: string | null
  errorMessage: string | null
}

/**
 * A business card. `front` and `back` are both required by the type — there is
 * no way to build one with a single side.
 */
export interface BusinessCardDesign {
  type: 'business_card'
  requestId: string
  front: DesignSurface
  back: DesignSurface
}

/** A flyer. One surface, and no back is implied or required. */
export interface FlyerDesign {
  type: 'flyer'
  requestId: string
  design: DesignSurface
}

export type DesignDocument = BusinessCardDesign | FlyerDesign

/** Standard business card: 3.5in x 2in. */
export const BUSINESS_CARD_SIZE: SurfaceSize = { width: 88.9, height: 50.8 }

/** Standard flyer: A4 portrait. */
export const FLYER_SIZE: SurfaceSize = { width: 210, height: 297 }

function createSurface(role: SurfaceRole, label: string, size: SurfaceSize): DesignSurface {
  return {
    role,
    label,
    status: 'pending',
    size,
    content: null,
    previewUrl: null,
    errorMessage: null,
  }
}

/**
 * Builds the empty document for a claimed request. A business card always comes
 * back with both sides present and pending.
 */
export function createDesignDocument(request: DesignRequestRecord): DesignDocument {
  if (request.design_type === 'flyer') {
    return {
      type: 'flyer',
      requestId: request.id,
      design: createSurface('flyer', 'Your flyer', FLYER_SIZE),
    }
  }

  return {
    type: 'business_card',
    requestId: request.id,
    front: createSurface('front', 'Front', BUSINESS_CARD_SIZE),
    back: createSurface('back', 'Back', BUSINESS_CARD_SIZE),
  }
}

/** Every surface of a document, in display order. */
export function getSurfaces(document: DesignDocument): DesignSurface[] {
  return document.type === 'business_card'
    ? [document.front, document.back]
    : [document.design]
}

export function getSurface(document: DesignDocument, role: SurfaceRole): DesignSurface | null {
  return getSurfaces(document).find((surface) => surface.role === role) ?? null
}

/**
 * A design is complete only when every surface it has is complete.
 *
 * For a business card that means the front AND the back — a card with only a
 * front is never reported as ready.
 */
export function isDesignComplete(document: DesignDocument): boolean {
  return getSurfaces(document).every((surface) => surface.status === 'complete')
}

export function hasDesignError(document: DesignDocument): boolean {
  return getSurfaces(document).some((surface) => surface.status === 'error')
}

/** Immutably applies a patch to one surface. */
export function updateSurface(
  document: DesignDocument,
  role: SurfaceRole,
  patch: Partial<Omit<DesignSurface, 'role' | 'label'>>
): DesignDocument {
  const apply = (surface: DesignSurface): DesignSurface =>
    surface.role === role ? { ...surface, ...patch } : surface

  if (document.type === 'business_card') {
    return { ...document, front: apply(document.front), back: apply(document.back) }
  }

  return { ...document, design: apply(document.design) }
}

/** The roles a given design type must produce, in order. */
export function requiredRoles(type: DesignType): SurfaceRole[] {
  return type === 'business_card' ? ['front', 'back'] : ['flyer']
}
