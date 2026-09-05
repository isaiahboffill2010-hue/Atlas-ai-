/**
 * The design generation state machine.
 *
 * The workspace never invents its own progress text or surface states: it holds
 * one state value, and everything the customer sees is derived from it here.
 * That keeps the two sides of a business card from drifting out of step with
 * the headline, and keeps internal names off the screen.
 */

import { updateSurface, getSurfaces } from './types'
import type { DesignDocument, SurfaceStatus } from './types'

export const DESIGN_GENERATION_STATES = [
  'queued',
  'received',
  'analyzing',
  'designing_front',
  'front_complete',
  'designing_back',
  'back_complete',
  'designing_flyer',
  'flyer_complete',
  'preview',
  'complete',
  'error',
] as const

export type DesignGenerationState = (typeof DESIGN_GENERATION_STATES)[number]

export function isDesignGenerationState(value: unknown): value is DesignGenerationState {
  return (
    typeof value === 'string' && (DESIGN_GENERATION_STATES as readonly string[]).includes(value)
  )
}

/** The states a business card passes through, in order. */
export const BUSINESS_CARD_SEQUENCE: DesignGenerationState[] = [
  'received',
  'analyzing',
  'designing_front',
  'front_complete',
  'designing_back',
  'back_complete',
  'preview',
  'complete',
]

/** The states a flyer passes through, in order. No front/back is implied. */
export const FLYER_SEQUENCE: DesignGenerationState[] = [
  'received',
  'analyzing',
  'designing_flyer',
  'flyer_complete',
  'preview',
  'complete',
]

export function sequenceFor(document: DesignDocument): DesignGenerationState[] {
  return document.type === 'business_card' ? BUSINESS_CARD_SEQUENCE : FLYER_SEQUENCE
}

export interface StateCopy {
  /** The large line. */
  headline: string
  /** The quieter line underneath. */
  detail: string
}

/**
 * What the customer reads for a given state. Friendly language only — no state
 * names, ids, status codes or anything about how the system works.
 */
export function describeState(state: DesignGenerationState, document: DesignDocument): StateCopy {
  const isCard = document.type === 'business_card'
  const thing = isCard ? 'business card' : 'flyer'

  switch (state) {
    case 'queued':
      return { headline: 'Getting started', detail: 'Atlas is picking up your details.' }
    case 'received':
      return { headline: 'Your information is ready', detail: 'Atlas has everything it needs.' }
    case 'analyzing':
      return {
        headline: 'Understanding your business',
        detail: 'Atlas is reading through what you sent.',
      }
    case 'designing_front':
      return { headline: 'Creating the front', detail: 'This is the side people see first.' }
    case 'front_complete':
      return { headline: 'The front is ready', detail: 'Starting on the back.' }
    case 'designing_back':
      return { headline: 'Creating the back', detail: 'Almost there.' }
    case 'back_complete':
      return { headline: 'Both sides are ready', detail: 'Putting everything together.' }
    case 'designing_flyer':
      return { headline: 'Creating your flyer', detail: 'Laying out your design.' }
    case 'flyer_complete':
      return { headline: 'Your flyer is taking shape', detail: 'Putting everything together.' }
    case 'preview':
      return { headline: 'Putting everything together', detail: 'Just a moment.' }
    case 'complete':
      return { headline: `Your ${thing} is ready`, detail: 'Take a look.' }
    case 'error':
      return {
        headline: 'Something went wrong while creating your design',
        detail: 'Nothing is lost — Atlas can try again.',
      }
  }
}

/**
 * The surface statuses implied by a state.
 *
 * Returning this from one place is what stops the UI from, say, showing a tick
 * on the back while the headline still says it is being created.
 */
function statusesForState(
  state: DesignGenerationState,
  document: DesignDocument
): Record<string, SurfaceStatus> {
  if (document.type === 'flyer') {
    switch (state) {
      case 'designing_flyer':
        return { flyer: 'designing' }
      case 'flyer_complete':
      case 'preview':
      case 'complete':
        return { flyer: 'complete' }
      case 'error':
        return { flyer: 'error' }
      default:
        return { flyer: 'pending' }
    }
  }

  switch (state) {
    case 'designing_front':
      return { front: 'designing', back: 'pending' }
    case 'front_complete':
      return { front: 'complete', back: 'pending' }
    case 'designing_back':
      return { front: 'complete', back: 'designing' }
    case 'back_complete':
    case 'preview':
    case 'complete':
      return { front: 'complete', back: 'complete' }
    case 'error':
      return { front: 'error', back: 'error' }
    default:
      return { front: 'pending', back: 'pending' }
  }
}

/**
 * Brings a document's surfaces in line with a state.
 *
 * Content and previews are left untouched: this only moves the status, so a
 * surface never claims to be complete while holding nothing to show unless the
 * generator actually filled it in.
 */
export function applyGenerationState(
  document: DesignDocument,
  state: DesignGenerationState
): DesignDocument {
  const statuses = statusesForState(state, document)

  return getSurfaces(document).reduce((next, surface) => {
    // A side that genuinely finished stays finished even when the job as a
    // whole fails: if the back could not be made, the front is still a real
    // design and the customer should still see it. The card is still not
    // complete — isDesignComplete requires every surface.
    if (state === 'error' && surface.status === 'complete') return next

    const status = statuses[surface.role]
    if (!status || status === surface.status) return next
    return updateSurface(next, surface.role, { status })
  }, document)
}

/** True once the state can no longer advance on its own. */
export function isTerminalState(state: DesignGenerationState): boolean {
  return state === 'complete' || state === 'error'
}

export function canRetry(state: DesignGenerationState): boolean {
  return state === 'error'
}

/**
 * Progress through the sequence, 0..1, for the progress indicator. `error` has
 * no meaningful progress and reports 0.
 */
export function progressFor(state: DesignGenerationState, document: DesignDocument): number {
  if (state === 'error') return 0

  const sequence = sequenceFor(document)
  const index = sequence.indexOf(state)
  if (index < 0) return 0

  return (index + 1) / sequence.length
}
