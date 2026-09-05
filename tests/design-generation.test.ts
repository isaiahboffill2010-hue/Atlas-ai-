import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { createDesignDocument, isDesignComplete, getSurfaces } from '../lib/design-engine/types'
import { applyGenerationState } from '../lib/design-engine/state'
import { startDesignGeneration, registerDesignGenerator } from '../lib/design-engine/generator'
import { createGeminiDesignGenerator } from '../lib/design-engine/gemini-generator'
import {
  buildSurfacePrompt,
  aspectRatioFor,
  reservedQrFrame,
  qrSurfaceFor,
  BUSINESS_CARD_ASPECT_RATIO,
  FLYER_ASPECT_RATIO,
} from '../lib/design-engine/prompt'
import {
  buildGeneratedStorageKey,
  validateGeneratedImage,
} from '../lib/design-requests/upload-validation'
import type { SurfaceResult, SurfaceRenderer } from '../lib/design-engine/gemini-generator'
import type { DesignGenerationState } from '../lib/design-engine/state'
import type { DesignDocument, SurfaceRole } from '../lib/design-engine/types'
import type { DesignRequestRecord, DesignType } from '../lib/design-requests/types'

const REQUEST_ID = 'b1d4e7f0-2c3a-4e56-9f81-0a7c5d3b2e64'
const LOGO_KEY = `design-requests/${REQUEST_ID}/logo.png`
const QR_KEY = `design-requests/${REQUEST_ID}/customer_qr.png`

function makeRequest(design_type: DesignType, overrides: Partial<DesignRequestRecord> = {}): DesignRequestRecord {
  return {
    id: REQUEST_ID,
    design_type,
    business_name: 'Atlas Printers',
    person_name: 'Isaiah Boffill',
    job_title: 'Owner',
    phone: '555-0100',
    email: 'hello@atlasprinters.example',
    website: 'atlasprinters.example',
    address: '1 Print Street',
    social_media: '@atlasprinters',
    additional_information: null,
    design_instructions: 'Modern and professional with black and gold.',
    flyer_details:
      design_type === 'flyer' ? { main_title: 'Summer Fair', description: 'All afternoon.' } : null,
    logo_file_reference: LOGO_KEY,
    customer_qr_file_reference: QR_KEY,
    status: 'received',
    created_at: '2026-09-05T00:00:00.000Z',
    updated_at: '2026-09-05T00:00:00.000Z',
    ...overrides,
  }
}

function jpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
}

/** Drives a generator and records everything it reported. */
async function run(
  request: DesignRequestRecord,
  renderSurface: SurfaceRenderer
): Promise<{ states: DesignGenerationState[]; document: DesignDocument; started: boolean }> {
  let document = createDesignDocument(request)
  const states: DesignGenerationState[] = []

  const hooks = {
    onState: (state: DesignGenerationState) => {
      states.push(state)
      document = applyGenerationState(document, state)
    },
    onSurface: (role: SurfaceRole, patch: any) => {
      const apply = (surface: any) => (surface.role === role ? { ...surface, ...patch } : surface)
      document =
        document.type === 'business_card'
          ? { ...document, front: apply(document.front), back: apply(document.back) }
          : { ...document, design: apply(document.design) }
    },
  }

  const generator = createGeminiDesignGenerator({ renderSurface })
  const result = await startDesignGeneration(
    request,
    document,
    hooks,
    new AbortController().signal
  )

  // startDesignGeneration only runs a registered generator; drive it directly
  // so the test does not depend on global registration order.
  if (!result.started) {
    try {
      await generator.generate(request, document, hooks, new AbortController().signal)
      return { states, document, started: true }
    } catch {
      hooks.onState('error')
      return { states, document, started: false }
    }
  }

  return { states, document, started: true }
}

function surfaceResult(role: SurfaceRole, withQr: boolean): SurfaceResult {
  const storageKey = `design-requests/${REQUEST_ID}/generated/${role}.jpg`
  return {
    storageKey,
    previewUrl: `https://storage.example/signed/${role}.jpg`,
    content: {
      size: role === 'flyer' ? { width: 210, height: 297 } : { width: 88.9, height: 50.8 },
      background: { kind: 'image', storageKey, fit: 'cover' },
      elements: withQr
        ? [
            {
              kind: 'image',
              id: 'customer-qr',
              source: 'customer_qr',
              storageKey: QR_KEY,
              fit: 'contain',
              frame: reservedQrFrame(role),
              rotation: 0,
              z: 10,
            },
          ]
        : [],
    },
    assetUrls: withQr ? { [QR_KEY]: 'https://storage.example/signed/qr.png' } : {},
  }
}

// ---------------------------------------------------------------------------
// Business card: request -> front -> back -> complete
// ---------------------------------------------------------------------------

test('a business card generates the front, then the back, then completes', async () => {
  const rendered: SurfaceRole[] = []

  const { states, document } = await run(makeRequest('business_card'), async ({ role }) => {
    rendered.push(role)
    return surfaceResult(role, role === qrSurfaceFor('business_card'))
  })

  assert.deepEqual(rendered, ['front', 'back'], 'both sides are generated, front first')

  // The lifecycle runs through the Phase 2A state machine, in order.
  assert.deepEqual(states, [
    'received',
    'analyzing',
    'designing_front',
    'front_complete',
    'designing_back',
    'back_complete',
    'preview',
    'complete',
  ])

  assert.equal(isDesignComplete(document), true)
  assert.equal(document.type, 'business_card')
  if (document.type !== 'business_card') return
  assert.equal(document.front.status, 'complete')
  assert.equal(document.back.status, 'complete')
  assert.ok(document.front.previewUrl, 'the front has generated artwork')
  assert.ok(document.back.previewUrl, 'the back has generated artwork')
})

test('a business card with only a front is NOT complete', async () => {
  // The back fails; the front succeeded.
  const { states, document } = await run(makeRequest('business_card'), async ({ role }) => {
    if (role === 'back') throw new Error('upstream failure')
    return surfaceResult(role, false)
  })

  assert.equal(isDesignComplete(document), false, 'one good side is not a finished card')
  assert.ok(states.includes('front_complete'))
  assert.ok(!states.includes('complete'), 'the job must never report itself complete')
  assert.equal(states[states.length - 1], 'error')

  if (document.type !== 'business_card') return
  assert.equal(document.front.status, 'complete')
  assert.equal(document.back.status, 'error')
})

test('a failure on the front stops the job before the back is attempted', async () => {
  const rendered: SurfaceRole[] = []

  const { states } = await run(makeRequest('business_card'), async ({ role }) => {
    rendered.push(role)
    throw new Error('upstream failure')
  })

  assert.deepEqual(rendered, ['front'], 'the back is not attempted after the front fails')
  assert.equal(states[states.length - 1], 'error')
})

// ---------------------------------------------------------------------------
// Flyer: one surface, no back
// ---------------------------------------------------------------------------

test('a flyer completes with a single surface and is never asked for a back', async () => {
  const rendered: SurfaceRole[] = []

  const { states, document } = await run(makeRequest('flyer'), async ({ role }) => {
    rendered.push(role)
    return surfaceResult(role, true)
  })

  assert.deepEqual(rendered, ['flyer'], 'a flyer generates exactly one surface')
  assert.equal(rendered.includes('back' as SurfaceRole), false)
  assert.deepEqual(states, [
    'received',
    'analyzing',
    'designing_flyer',
    'flyer_complete',
    'preview',
    'complete',
  ])
  assert.equal(isDesignComplete(document), true)
  assert.equal(getSurfaces(document).length, 1)
})

// ---------------------------------------------------------------------------
// The customer's QR code is preserved, never regenerated
// ---------------------------------------------------------------------------

test('the prompt forbids drawing a QR code and reserves space for the real one', () => {
  const prompt = buildSurfacePrompt({
    request: makeRequest('business_card'),
    role: 'back',
    reserveQrArea: true,
    hasLogoReference: true,
  })

  assert.match(prompt, /Do NOT draw a QR code/i)
  assert.match(prompt, /bottom-right corner completely clear/i)
  assert.match(prompt, /customer's own QR code will be placed there/i)
})

test('even without a reserved area, the model is told never to draw a QR code', () => {
  const prompt = buildSurfacePrompt({
    request: makeRequest('business_card', { customer_qr_file_reference: null }),
    role: 'front',
    reserveQrArea: false,
    hasLogoReference: false,
  })

  assert.match(prompt, /Do NOT draw a QR code/i)
})

test("the generated surface carries the customer's original QR file, not a new one", async () => {
  const { document } = await run(makeRequest('business_card'), async ({ role }) =>
    surfaceResult(role, role === 'back')
  )

  if (document.type !== 'business_card') return

  const qrElement = document.back.content?.elements.find((e) => e.source === 'customer_qr')
  assert.ok(qrElement, 'the back keeps the QR as its own element')
  assert.equal(qrElement?.kind, 'image')
  assert.equal(
    qrElement?.kind === 'image' ? qrElement.storageKey : null,
    QR_KEY,
    'it points at the file the customer uploaded'
  )

  // The generated artwork is the background, and is a different asset entirely.
  assert.equal(document.back.content?.background.kind, 'image')
  const background = document.back.content?.background
  assert.notEqual(
    background?.kind === 'image' ? background.storageKey : null,
    QR_KEY,
    'the QR is never the generated artwork'
  )

  // The front carries no QR — it belongs on the back.
  assert.equal(qrSurfaceFor('business_card'), 'back')
  assert.equal(document.front.content?.elements.length, 0)
})

test('the QR is reserved a real, on-card area that can be moved later', () => {
  const frame = reservedQrFrame('back')

  assert.ok(frame.width > 0 && frame.height > 0)
  assert.equal(frame.width, frame.height, 'a QR code is square')
  // Inside the 88.9 x 50.8mm card, with a margin.
  assert.ok(frame.x + frame.width <= 88.9)
  assert.ok(frame.y + frame.height <= 50.8)
  assert.ok(frame.x > 44, 'positioned toward the right')
})

// ---------------------------------------------------------------------------
// It has to look like a business card
// ---------------------------------------------------------------------------

test('the prompt pins the output to a business card, not a poster or a mockup', () => {
  for (const role of ['front', 'back'] as SurfaceRole[]) {
    const prompt = buildSurfacePrompt({
      request: makeRequest('business_card'),
      role,
      reserveQrArea: false,
      hasLogoReference: false,
    })

    assert.match(prompt, /BUSINESS CARD/)
    assert.match(prompt, /3\.5 x 2 inches/)
    assert.match(prompt, /not a poster/i)
    assert.match(prompt, /social media post/i)
    assert.match(prompt, /mockup/i)
  }
})

test('front and back use the same physical proportions', () => {
  assert.equal(aspectRatioFor('front'), aspectRatioFor('back'))
  assert.equal(aspectRatioFor('front'), BUSINESS_CARD_ASPECT_RATIO)
  assert.equal(aspectRatioFor('flyer'), FLYER_ASPECT_RATIO)
  assert.notEqual(BUSINESS_CARD_ASPECT_RATIO, FLYER_ASPECT_RATIO)
})

test("the customer's design instructions are the creative direction", () => {
  const prompt = buildSurfacePrompt({
    request: makeRequest('business_card'),
    role: 'front',
    reserveQrArea: false,
    hasLogoReference: false,
  })

  assert.match(prompt, /Modern and professional with black and gold\./)
  assert.match(prompt, /primary creative direction/i)
})

test('the prompt only contains details the customer actually supplied', () => {
  const sparse = makeRequest('business_card', {
    person_name: null,
    job_title: null,
    phone: null,
    address: null,
    social_media: null,
  })

  const prompt = buildSurfacePrompt({
    request: sparse,
    role: 'front',
    reserveQrArea: false,
    hasLogoReference: false,
  })

  assert.match(prompt, /Atlas Printers/)
  assert.ok(!prompt.includes('Person:'), 'no empty fields are offered to the model')
  assert.ok(!prompt.includes('Phone:'))
  assert.match(prompt, /Do not invent contact details/i)
})

test('the logo is described as the customer\'s own, to be reproduced faithfully', () => {
  const withLogo = buildSurfacePrompt({
    request: makeRequest('business_card'),
    role: 'front',
    reserveQrArea: false,
    hasLogoReference: true,
  })

  assert.match(withLogo, /customer's own logo/i)
  assert.match(withLogo, /do not\s+redraw, restyle, recolour or reinterpret/i)

  const withoutLogo = buildSurfacePrompt({
    request: makeRequest('business_card', { logo_file_reference: null }),
    role: 'front',
    reserveQrArea: false,
    hasLogoReference: false,
  })
  assert.ok(!/customer's own logo/i.test(withoutLogo))
})

// ---------------------------------------------------------------------------
// Generated assets are validated and stored under the request
// ---------------------------------------------------------------------------

test('generated images are validated by content before being stored', () => {
  assert.equal(validateGeneratedImage(jpeg(), 'image/jpeg').ok, true)

  // An error page or truncated response must never be stored as a design.
  assert.equal(validateGeneratedImage(Buffer.from('{"error":"quota"}')).ok, false)
  assert.equal(validateGeneratedImage(Buffer.alloc(0)).ok, false)
  assert.equal(validateGeneratedImage(jpeg(), 'image/png').ok, false)
})

test('generated designs are stored under their own request, apart from uploads', () => {
  const front = buildGeneratedStorageKey(REQUEST_ID, 'front', {
    mimeType: 'image/jpeg',
    extension: 'jpg',
  })
  const back = buildGeneratedStorageKey(REQUEST_ID, 'back', {
    mimeType: 'image/jpeg',
    extension: 'jpg',
  })

  assert.equal(front, `design-requests/${REQUEST_ID}/generated/front.jpg`)
  assert.notEqual(front, back)
  assert.ok(!front.includes('..'))
  // Customer uploads live outside generated/, so the two can never collide.
  assert.ok(!front.startsWith(LOGO_KEY))
  assert.ok(front.includes('/generated/'))
  assert.ok(!LOGO_KEY.includes('/generated/'))

  // Retries do not overwrite the previous attempt.
  assert.equal(
    buildGeneratedStorageKey(REQUEST_ID, 'front', { mimeType: 'image/jpeg', extension: 'jpg' }, 2),
    `design-requests/${REQUEST_ID}/generated/front-2.jpg`
  )
})

test('storage keys reject anything that is not a real request id or surface', () => {
  const format = { mimeType: 'image/jpeg', extension: 'jpg' }
  assert.throws(() => buildGeneratedStorageKey('../../evil', 'front', format))
  assert.throws(() => buildGeneratedStorageKey(REQUEST_ID, '../back', format))
  assert.throws(() => buildGeneratedStorageKey(REQUEST_ID, 'front/../..', format))
})

// ---------------------------------------------------------------------------
// Security: the Gemini key stays on the server
// ---------------------------------------------------------------------------

test('the client-side generator never reads the Gemini API key', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'lib/design-engine/gemini-generator.ts'),
    'utf8'
  )

  assert.ok(!source.includes('GEMINI_API_KEY'), 'no key reference in client code')
  assert.ok(!source.includes('generativelanguage.googleapis.com'), 'no direct Gemini calls')
  assert.ok(!source.includes('gemini-image'), 'the server-only module is not imported')
  assert.match(source, /\/api\/design-requests\/generate/, 'it goes through the server route')
})

test('the workspace page never imports the server-only Gemini module', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'pages/atlasdesign.tsx'), 'utf8')

  assert.ok(!page.includes('gemini-image'))
  assert.ok(!page.includes('GEMINI_API_KEY'))
})

test('the server-only Gemini module is only reached from an API route', () => {
  const root = process.cwd()
  const offenders: string[] = []

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', '.next', '.git'].includes(entry.name)) continue
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue

      const relative = path.relative(root, full).replace(/\\/g, '/')
      if (relative.startsWith('pages/api/') || relative === 'lib/design-engine/gemini-image.ts') {
        continue
      }
      if (relative.startsWith('tests/')) continue

      if (fs.readFileSync(full, 'utf8').includes('design-engine/gemini-image')) {
        offenders.push(relative)
      }
    }
  }

  walk(root)
  assert.deepEqual(offenders, [], 'only API routes may import the server-only Gemini module')
})

// ---------------------------------------------------------------------------
// The real path is what runs
// ---------------------------------------------------------------------------

test('the generator registered by the workspace is the Gemini design engine', () => {
  const generator = createGeminiDesignGenerator()
  assert.equal(generator.name, 'gemini-design-engine')

  registerDesignGenerator(generator)

  const page = fs.readFileSync(path.join(process.cwd(), 'pages/atlasdesign.tsx'), 'utf8')
  assert.match(page, /registerDesignGenerator\(/)
  assert.match(page, /createGeminiDesignGenerator\(/)
})

test('by default the generator calls the server generation route', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'lib/design-engine/gemini-generator.ts'),
    'utf8'
  )
  // The injectable renderer exists for tests, but the default is the real call.
  assert.match(source, /options\.renderSurface \?\? fetchSurfaceFromServer/)
})

test('field labels are for the model, not for printing on the card', () => {
  const prompt = buildSurfacePrompt({
    request: makeRequest('business_card'),
    role: 'back',
    reserveQrArea: true,
    hasLogoReference: false,
  })

  assert.match(prompt, /Do not print those labels on the design/i)
  assert.match(prompt, /for your reference/i)
})

test('framing is pinned so the artwork is the card, not a photo of one', () => {
  for (const role of ['front', 'back', 'flyer'] as SurfaceRole[]) {
    const prompt = buildSurfacePrompt({
      request: makeRequest(role === 'flyer' ? 'flyer' : 'business_card'),
      role,
      reserveQrArea: false,
      hasLogoReference: false,
    })

    assert.match(prompt, /fill the entire image, edge to edge, with full bleed/i)
    assert.match(prompt, /no white or coloured margin/i)
    assert.match(prompt, /no mockup, no photograph/i)
    // Stated early, before the creative direction, so it is not buried.
    assert.ok(prompt.indexOf('CRITICAL') < prompt.length / 2, 'framing must come early')
  }
})
