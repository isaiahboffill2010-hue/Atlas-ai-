import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDesignDocument,
  getSurfaces,
  getSurface,
  isDesignComplete,
  hasDesignError,
  updateSurface,
  requiredRoles,
  BUSINESS_CARD_SIZE,
  FLYER_SIZE,
} from '../lib/design-engine/types'
import {
  applyGenerationState,
  describeState,
  progressFor,
  sequenceFor,
  isTerminalState,
  canRetry,
  isDesignGenerationState,
  BUSINESS_CARD_SEQUENCE,
  FLYER_SEQUENCE,
  DESIGN_GENERATION_STATES,
} from '../lib/design-engine/state'
import { getDesignGenerator } from '../lib/design-engine/generator'
import type { DesignRequestRecord, DesignType } from '../lib/design-requests/types'
import type { BusinessCardDesign } from '../lib/design-engine/types'

function makeRequest(design_type: DesignType): DesignRequestRecord {
  return {
    id: 'b1d4e7f0-2c3a-4e56-9f81-0a7c5d3b2e64',
    design_type,
    business_name: 'Atlas Printers',
    person_name: null,
    job_title: null,
    phone: null,
    email: null,
    website: null,
    address: null,
    social_media: null,
    additional_information: null,
    design_instructions: 'Modern, black and gold.',
    flyer_details: design_type === 'flyer' ? { main_title: 'Summer Fair', description: null } : null,
    logo_file_reference: null,
    customer_qr_file_reference: null,
    status: 'received',
    created_at: '2026-09-05T00:00:00.000Z',
    updated_at: '2026-09-05T00:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// A business card always has a front AND a back
// ---------------------------------------------------------------------------

test('a business card is created with both a front and a back', () => {
  const card = createDesignDocument(makeRequest('business_card')) as BusinessCardDesign

  assert.equal(card.type, 'business_card')
  assert.ok(card.front, 'front must exist')
  assert.ok(card.back, 'back must exist')
  assert.deepEqual(
    getSurfaces(card).map((s) => s.role),
    ['front', 'back']
  )
  assert.deepEqual(requiredRoles('business_card'), ['front', 'back'])
})

test('a business card with only the front finished is NOT complete', () => {
  const card = createDesignDocument(makeRequest('business_card'))

  const frontOnly = updateSurface(card, 'front', { status: 'complete' })
  assert.equal(isDesignComplete(frontOnly), false, 'one side is never a finished card')

  const bothSides = updateSurface(frontOnly, 'back', { status: 'complete' })
  assert.equal(isDesignComplete(bothSides), true)
})

test('a business card with only the back finished is NOT complete', () => {
  const card = createDesignDocument(makeRequest('business_card'))
  const backOnly = updateSurface(card, 'back', { status: 'complete' })

  assert.equal(isDesignComplete(backOnly), false)
})

test('there is no flattened single-image field standing in for a whole card', () => {
  const card = createDesignDocument(makeRequest('business_card')) as unknown as Record<
    string,
    unknown
  >

  for (const flattened of ['image', 'imageUrl', 'previewUrl', 'design']) {
    assert.equal(card[flattened], undefined, `a card must not carry a top-level "${flattened}"`)
  }
})

test('each surface keeps its own structured, editable content', () => {
  const card = createDesignDocument(makeRequest('business_card')) as BusinessCardDesign

  // Nothing is generated yet, so content starts empty rather than faked.
  assert.equal(card.front.content, null)
  assert.equal(card.back.content, null)

  const withLogo = updateSurface(card, 'front', {
    content: {
      size: BUSINESS_CARD_SIZE,
      background: { kind: 'solid', color: '#000000' },
      elements: [
        {
          kind: 'image',
          id: 'logo-1',
          source: 'logo',
          storageKey: 'design-requests/x/logo.png',
          fit: 'contain',
          frame: { x: 6, y: 6, width: 20, height: 20 },
          rotation: 0,
          z: 1,
        },
      ],
    },
  }) as BusinessCardDesign

  // "Make the logo bigger" is an element edit, not a re-render.
  const logo = withLogo.front.content?.elements[0]
  assert.equal(logo?.kind, 'image')
  assert.equal(logo?.source, 'logo')
  assert.equal(logo?.frame.width, 20)
  assert.equal(withLogo.back.content, null, 'editing one side leaves the other alone')
})

// ---------------------------------------------------------------------------
// Flyers are not forced into the front/back model
// ---------------------------------------------------------------------------

test('a flyer has a single surface and never requires a back', () => {
  const flyer = createDesignDocument(makeRequest('flyer'))

  assert.equal(flyer.type, 'flyer')
  assert.deepEqual(
    getSurfaces(flyer).map((s) => s.role),
    ['flyer']
  )
  assert.equal(getSurface(flyer, 'back'), null, 'a flyer has no back')
  assert.deepEqual(requiredRoles('flyer'), ['flyer'])
  assert.deepEqual(getSurfaces(flyer)[0].size, FLYER_SIZE)
})

test('a flyer is complete once its single surface is done', () => {
  const flyer = createDesignDocument(makeRequest('flyer'))
  assert.equal(isDesignComplete(flyer), false)

  assert.equal(isDesignComplete(updateSurface(flyer, 'flyer', { status: 'complete' })), true)
})

// ---------------------------------------------------------------------------
// The state machine drives the surfaces
// ---------------------------------------------------------------------------

test('every declared state is recognised', () => {
  for (const state of DESIGN_GENERATION_STATES) {
    assert.equal(isDesignGenerationState(state), true)
  }
  assert.equal(isDesignGenerationState('rendering'), false)
})

test('business card states move the two sides in the right order', () => {
  const card = createDesignDocument(makeRequest('business_card'))

  const designingFront = applyGenerationState(card, 'designing_front') as BusinessCardDesign
  assert.equal(designingFront.front.status, 'designing')
  assert.equal(designingFront.back.status, 'pending', 'the back waits its turn')
  assert.equal(isDesignComplete(designingFront), false)

  const frontDone = applyGenerationState(card, 'front_complete') as BusinessCardDesign
  assert.equal(frontDone.front.status, 'complete')
  assert.equal(frontDone.back.status, 'pending')
  assert.equal(isDesignComplete(frontDone), false, 'a finished front is not a finished card')

  const designingBack = applyGenerationState(card, 'designing_back') as BusinessCardDesign
  assert.equal(designingBack.front.status, 'complete')
  assert.equal(designingBack.back.status, 'designing')

  const done = applyGenerationState(card, 'complete') as BusinessCardDesign
  assert.equal(done.front.status, 'complete')
  assert.equal(done.back.status, 'complete')
  assert.equal(isDesignComplete(done), true)
})

test('the flyer sequence never mentions a front or a back', () => {
  const flyer = createDesignDocument(makeRequest('flyer'))

  assert.deepEqual(sequenceFor(flyer), FLYER_SEQUENCE)
  assert.equal(
    FLYER_SEQUENCE.some((s) => s.includes('front') || s.includes('back')),
    false
  )
  assert.ok(BUSINESS_CARD_SEQUENCE.includes('designing_back'))

  const designing = applyGenerationState(flyer, 'designing_flyer')
  assert.equal(getSurfaces(designing)[0].status, 'designing')
})

test('the error state marks the design as failed and offers a retry', () => {
  const card = createDesignDocument(makeRequest('business_card'))
  const failed = applyGenerationState(card, 'error')

  assert.equal(hasDesignError(failed), true)
  assert.equal(isDesignComplete(failed), false)
  assert.equal(canRetry('error'), true)
  assert.equal(canRetry('designing_front'), false)
  assert.equal(isTerminalState('error'), true)
  assert.equal(isTerminalState('complete'), true)
  assert.equal(isTerminalState('analyzing'), false)
})

test('progress advances through the sequence and is zero on error', () => {
  const card = createDesignDocument(makeRequest('business_card'))

  assert.ok(progressFor('analyzing', card) < progressFor('designing_back', card))
  assert.ok(progressFor('designing_back', card) < progressFor('complete', card))
  assert.equal(progressFor('complete', card), 1)
  assert.equal(progressFor('error', card), 0)
})

// ---------------------------------------------------------------------------
// Nothing internal reaches the customer
// ---------------------------------------------------------------------------

test('customer-facing copy never leaks internal names, ids or jargon', () => {
  const card = createDesignDocument(makeRequest('business_card'))
  const flyer = createDesignDocument(makeRequest('flyer'))
  const forbidden = [
    'uuid',
    'supabase',
    'request id',
    'requestid',
    'polling',
    'status',
    'api',
    'database',
    'pending',
    'designing_',
    'null',
    'undefined',
  ]

  for (const document of [card, flyer]) {
    for (const state of DESIGN_GENERATION_STATES) {
      const { headline, detail } = describeState(state, document)
      const text = `${headline} ${detail}`.toLowerCase()

      assert.ok(headline.length > 0 && detail.length > 0, `${state} needs copy`)
      assert.ok(!text.includes(document.requestId), 'the request id must never be shown')

      for (const word of forbidden) {
        assert.ok(!text.includes(word), `"${state}" copy must not contain "${word}": ${text}`)
      }
    }
  }
})

test('the completion message names the right product', () => {
  assert.match(
    describeState('complete', createDesignDocument(makeRequest('business_card'))).headline,
    /business card is ready/i
  )
  assert.match(
    describeState('complete', createDesignDocument(makeRequest('flyer'))).headline,
    /flyer is ready/i
  )
})

test('the error message is friendly and offers reassurance', () => {
  const copy = describeState('error', createDesignDocument(makeRequest('business_card')))
  assert.match(copy.headline, /something went wrong while creating your design/i)
})

// ---------------------------------------------------------------------------
// The generator seam is present but empty in this phase
// ---------------------------------------------------------------------------

test('no design generator is registered yet, so nothing can fake a finished design', () => {
  assert.equal(getDesignGenerator(), null)
})
