import test from 'node:test'
import assert from 'node:assert/strict'

import { isDesignType, isDesignRequestStatus } from '../lib/design-requests/types'
import {
  validateSubmission,
  isValidRequestId,
  sanitizeText,
  MAX_LENGTHS,
} from '../lib/design-requests/validation'
import {
  validateImageUpload,
  buildUploadStorageKey,
  sniffImageFormat,
  claimedImageFormat,
  MAX_UPLOAD_BYTES,
} from '../lib/design-requests/upload-validation'
import { authorizeKioskRequest } from '../lib/design-requests/kiosk-auth'
import { CUSTOMER_INTAKE_URL } from '../lib/config'

const REQUEST_ID = 'b1d4e7f0-2c3a-4e56-9f81-0a7c5d3b2e64'
const OTHER_REQUEST_ID = '3f6a1c2e-9b47-4d81-a5f0-6d2c8e1b4a97'
const PNG: { mimeType: string; extension: string } = { mimeType: 'image/png', extension: 'png' }

function pngBuffer(extraBytes = 32): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extraBytes, 1),
  ])
}

function jpegBuffer(extraBytes = 32): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extraBytes, 1)])
}

function webpBuffer(): Buffer {
  const buffer = Buffer.alloc(64, 0)
  buffer.write('RIFF', 0, 'ascii')
  buffer.write('WEBP', 8, 'ascii')
  return buffer
}

// ---------------------------------------------------------------------------
// Design type validation
// ---------------------------------------------------------------------------

test('design type accepts only the two typed values', () => {
  assert.equal(isDesignType('business_card'), true)
  assert.equal(isDesignType('flyer'), true)

  for (const bad of ['Business Card', 'poster', '', 'BUSINESS_CARD', null, 42, undefined]) {
    assert.equal(isDesignType(bad), false, `expected ${String(bad)} to be rejected`)
  }
})

test('submission is rejected when the design type is free-form', () => {
  const result = validateSubmission({ design_type: 'business card', business_name: 'Atlas' })
  assert.equal(result.ok, false)
  assert.ok(result.ok === false && result.fieldErrors.design_type, 'expected a design_type error')
})

test('the status lifecycle is constrained to the known set', () => {
  for (const status of ['pending', 'received', 'processing', 'completed', 'failed']) {
    assert.equal(isDesignRequestStatus(status), true)
  }
  assert.equal(isDesignRequestStatus('done'), false)
  assert.equal(isDesignRequestStatus(undefined), false)
})

// ---------------------------------------------------------------------------
// Required business name
// ---------------------------------------------------------------------------

test('business name is required', () => {
  const missing = validateSubmission({ design_type: 'business_card' })
  assert.equal(missing.ok, false)
  assert.ok(missing.ok === false && missing.fieldErrors.business_name)

  const blank = validateSubmission({ design_type: 'flyer', business_name: '   \n  ' })
  assert.equal(blank.ok, false)
  assert.ok(blank.ok === false && blank.fieldErrors.business_name)
})

test('business name is length limited', () => {
  const result = validateSubmission({
    design_type: 'business_card',
    business_name: 'a'.repeat(MAX_LENGTHS.business_name + 1),
  })
  assert.equal(result.ok, false)
  assert.ok(result.ok === false && result.fieldErrors.business_name)
})

// ---------------------------------------------------------------------------
// Request ids
// ---------------------------------------------------------------------------

test('only UUID request ids are accepted', () => {
  assert.equal(isValidRequestId(REQUEST_ID), true)
  assert.equal(isValidRequestId(REQUEST_ID.toUpperCase()), true)

  for (const bad of [
    '',
    'not-a-uuid',
    '../../etc/passwd',
    `${REQUEST_ID}/../other`,
    `${REQUEST_ID} `,
    REQUEST_ID.slice(0, -1),
    null,
    undefined,
    123,
  ]) {
    assert.equal(isValidRequestId(bad), false, `expected ${String(bad)} to be rejected`)
  }
})

// ---------------------------------------------------------------------------
// Submission validation
// ---------------------------------------------------------------------------

test('a valid business card submission is normalised', () => {
  const result = validateSubmission({
    design_type: 'business_card',
    business_name: '  Atlas Printers  ',
    person_name: 'Isaiah',
    job_title: '',
    email: 'hello@atlasprinters.example',
    design_instructions: 'Modern and professional with black and gold.',
    unexpected_field: 'ignored',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.value.business_name, 'Atlas Printers')
  assert.equal(result.value.person_name, 'Isaiah')
  assert.equal(result.value.job_title, null, 'empty optional fields become null')
  assert.equal(result.value.design_instructions, 'Modern and professional with black and gold.')
  assert.equal(result.value.flyer_details, null, 'business cards carry no flyer details')
  assert.equal((result.value as unknown as Record<string, unknown>).unexpected_field, undefined)
  assert.equal(
    (result.value as unknown as Record<string, unknown>).session_id,
    undefined,
    'submissions no longer carry a session id'
  )
})

test('flyer-only fields are kept in flyer_details', () => {
  const result = validateSubmission({
    design_type: 'flyer',
    business_name: 'Community Centre',
    main_title: 'Summer Fair',
    description: 'Games, food and music all afternoon.',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.deepEqual(result.value.flyer_details, {
    main_title: 'Summer Fair',
    description: 'Games, food and music all afternoon.',
  })
})

test('business card submissions do not carry flyer fields', () => {
  const result = validateSubmission({
    design_type: 'business_card',
    business_name: 'Atlas Printers',
    main_title: 'Should be dropped',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.flyer_details, null)
})

test('bad contact details are reported per field so the page can highlight them', () => {
  const result = validateSubmission({
    design_type: 'business_card',
    business_name: 'Atlas Printers',
    email: 'not-an-email',
    phone: 'call me',
  })

  assert.equal(result.ok, false)
  if (result.ok) return

  assert.ok(result.fieldErrors.email)
  assert.ok(result.fieldErrors.phone)
  assert.equal(result.fieldErrors.business_name, undefined)
})

test('a submission with only the required field is accepted', () => {
  const result = validateSubmission({
    design_type: 'flyer',
    business_name: 'Atlas Printers',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value.flyer_details, { main_title: null, description: null })
})

test('control characters are stripped from customer text', () => {
  assert.equal(sanitizeText('Atlas\u0000 Printers'), 'Atlas Printers')
  assert.equal(sanitizeText('line one\r\nline two'), 'line one\nline two')
  assert.equal(sanitizeText('  padded  '), 'padded')
})

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------

test('image formats are identified from their bytes', () => {
  assert.equal(sniffImageFormat(pngBuffer())?.mimeType, 'image/png')
  assert.equal(sniffImageFormat(jpegBuffer())?.mimeType, 'image/jpeg')
  assert.equal(sniffImageFormat(webpBuffer())?.mimeType, 'image/webp')
  assert.equal(sniffImageFormat(Buffer.from('<svg></svg>')), null)
  assert.equal(sniffImageFormat(Buffer.alloc(0)), null)
})

test('a real PNG is accepted and gets a png extension', () => {
  const result = validateImageUpload(pngBuffer(), {
    filename: 'logo.png',
    mimeType: 'image/png',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.format.extension, 'png')
})

test('non-image uploads are rejected', () => {
  const script = Buffer.from('#!/bin/sh\nrm -rf /\n')
  const result = validateImageUpload(script, { filename: 'logo.png', mimeType: 'image/png' })
  assert.equal(result.ok, false)
})

test('SVG is rejected because it cannot be verified and can carry script', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
  const result = validateImageUpload(svg, { filename: 'logo.svg', mimeType: 'image/svg+xml' })
  assert.equal(result.ok, false)
})

test('an extension that contradicts the contents is rejected, not relabelled', () => {
  const result = validateImageUpload(pngBuffer(), { filename: 'logo.jpg' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /image\/png/)
})

test('a misleading mime type is rejected', () => {
  const result = validateImageUpload(jpegBuffer(), {
    filename: 'logo.jpeg',
    mimeType: 'image/png',
  })
  assert.equal(result.ok, false)
})

test('oversized and truncated uploads are rejected', () => {
  const tooBig = Buffer.concat([pngBuffer(), Buffer.alloc(MAX_UPLOAD_BYTES)])
  assert.equal(validateImageUpload(tooBig, { filename: 'logo.png' }).ok, false)

  const truncated = validateImageUpload(pngBuffer(), { filename: 'logo.png', truncated: true })
  assert.equal(truncated.ok, false)

  assert.equal(validateImageUpload(Buffer.alloc(0), { filename: 'logo.png' }).ok, false)
})

test('a malicious filename only ever contributes its extension claim', () => {
  assert.equal(claimedImageFormat('../../../etc/passwd.png')?.extension, 'png')
  assert.equal(claimedImageFormat('C:\\Windows\\System32\\evil.jpg')?.extension, 'jpg')
  assert.equal(claimedImageFormat('no-extension'), null)
})

test('storage keys are scoped to the request and built from generated ids only', () => {
  const key = buildUploadStorageKey(REQUEST_ID, 'logo', PNG)

  assert.equal(key, `design-requests/${REQUEST_ID}/logo.png`)
  assert.ok(!key.includes('..'))
})

test('storage keys refuse ids that are not UUIDs', () => {
  assert.throws(() => buildUploadStorageKey('../../evil', 'logo', PNG))
  assert.throws(() => buildUploadStorageKey('not-a-uuid', 'customer_qr', PNG))
})

test('two customers never share a storage path', () => {
  assert.notEqual(
    buildUploadStorageKey(REQUEST_ID, 'logo', PNG),
    buildUploadStorageKey(OTHER_REQUEST_ID, 'logo', PNG)
  )
})

// ---------------------------------------------------------------------------
// The permanent kiosk QR vs the customer's uploaded QR — never the same thing
// ---------------------------------------------------------------------------

test('the customer QR upload is stored separately from the logo', () => {
  const logoKey = buildUploadStorageKey(REQUEST_ID, 'logo', PNG)
  const customerQrKey = buildUploadStorageKey(REQUEST_ID, 'customer_qr', PNG)

  assert.notEqual(logoKey, customerQrKey)
  assert.match(customerQrKey, /customer_qr\.png$/)
})

test('the kiosk entry QR is a fixed URL that the app never generates or stores', () => {
  // The permanent QR code encodes exactly this, and nothing else.
  assert.equal(CUSTOMER_INTAKE_URL, 'https://atlas-ai-two-phi.vercel.app/session')
  assert.ok(!CUSTOMER_INTAKE_URL.includes('/create/'))
  assert.ok(!CUSTOMER_INTAKE_URL.includes('sessionId'))

  // ...while the customer's own QR code is an uploaded image in storage.
  const customerQrKey = buildUploadStorageKey(REQUEST_ID, 'customer_qr', PNG)
  assert.ok(!customerQrKey.startsWith('http'))
  assert.ok(!CUSTOMER_INTAKE_URL.includes('customer_qr'))

  // A submission's typed shape has no field for the kiosk QR at all.
  const submission = validateSubmission({
    design_type: 'business_card',
    business_name: 'Atlas Printers',
  })
  assert.equal(submission.ok, true)
  if (!submission.ok) return
  assert.equal(
    Object.keys(submission.value).some((key) => key.includes('session') || key.includes('kiosk')),
    false
  )
})

// ---------------------------------------------------------------------------
// Who may read submitted customer information back
// ---------------------------------------------------------------------------

test('a configured kiosk token is required and compared exactly', () => {
  const configuredToken = 'a-long-random-kiosk-secret'

  assert.deepEqual(authorizeKioskRequest({ configuredToken, token: configuredToken }), {
    ok: true,
    via: 'token',
  })

  for (const bad of ['', 'wrong', 'a-long-random-kiosk-secre', 'a-long-random-kiosk-secretx']) {
    assert.equal(
      authorizeKioskRequest({ configuredToken, token: bad }).ok,
      false,
      `expected "${bad}" to be refused`
    )
  }

  // Surrounding whitespace on the header is tolerated, as headers routinely
  // pick it up; the value itself still has to match.
  assert.equal(
    authorizeKioskRequest({ configuredToken, token: ' a-long-random-kiosk-secret ' }).ok,
    true
  )

  // Loopback is no help once a token is configured.
  assert.equal(
    authorizeKioskRequest({ configuredToken, remoteAddress: '127.0.0.1' }).ok,
    false
  )
})

test('without a configured token, only local callers may read submissions', () => {
  assert.deepEqual(authorizeKioskRequest({ remoteAddress: '127.0.0.1' }), {
    ok: true,
    via: 'loopback',
  })
  assert.deepEqual(authorizeKioskRequest({ remoteAddress: '::1' }), { ok: true, via: 'loopback' })

  assert.equal(authorizeKioskRequest({ remoteAddress: '203.0.113.7' }).ok, false)
  assert.equal(authorizeKioskRequest({}).ok, false)
})

test('a proxied request is never mistaken for a local one', () => {
  // Vercel and friends put the real client in x-forwarded-for while the socket
  // shows the platform's own loopback proxy.
  assert.equal(
    authorizeKioskRequest({ remoteAddress: '127.0.0.1', forwardedFor: '203.0.113.7' }).ok,
    false
  )
  assert.equal(
    authorizeKioskRequest({ remoteAddress: '127.0.0.1', forwardedFor: '203.0.113.7, 127.0.0.1' })
      .ok,
    false
  )
})

test('the read endpoints are closed entirely on a hosted deployment without a token', () => {
  assert.equal(
    authorizeKioskRequest({ remoteAddress: '127.0.0.1', isServerless: true }).ok,
    false,
    'customer data must not be readable from the public deployment'
  )

  assert.equal(
    authorizeKioskRequest({
      remoteAddress: '127.0.0.1',
      isServerless: true,
      configuredToken: 'secret',
      token: 'secret',
    }).ok,
    true
  )
})
