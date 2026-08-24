const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const SQUARE_DEVICE_API_VERSION = '2026-08-19'
const SQUARE_TERMINAL_API_VERSION = '2026-07-15'
const SQUARE_PAYMENTS_API_VERSION = '2026-01-22'
const SQUARE_STATE_FILE = path.join(process.cwd(), 'Atlas', 'database', 'square.json')

function getSquareEnvironment() {
  const raw = String(process.env.SQUARE_ENVIRONMENT || 'production').trim().toLowerCase()
  if (raw !== 'production' && raw !== 'sandbox') {
    throw new Error('SQUARE_ENVIRONMENT must be set to production or sandbox')
  }
  return raw
}

function getSquareBaseUrl() {
  return getSquareEnvironment() === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com'
}

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) {
    throw new Error(`${name} is not configured`)
  }
  return value
}

function getSquareAccessToken() {
  return getRequiredEnv('SQUARE_ACCESS_TOKEN')
}

function getSquareLocationId() {
  return getRequiredEnv('SQUARE_LOCATION_ID')
}

function getSquareWebhookSignatureKey() {
  return getRequiredEnv('SQUARE_WEBHOOK_SIGNATURE_KEY')
}

function getSquareWebhookNotificationUrl() {
  return getRequiredEnv('SQUARE_WEBHOOK_NOTIFICATION_URL')
}

function ensureStateDir() {
  const dir = path.dirname(SQUARE_STATE_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function defaultSquareState() {
  return {
    pairing: {
      merchant_id: null,
      location_id: null,
      device_code_id: null,
      device_code: null,
      device_name: 'Atlas Front Desk',
      device_id: null,
      status: null,
      pair_by: null,
      created_at: null,
      updated_at: null,
      paired_at: null,
    },
    webhook_events: {},
    payments: [],
    updated_at: null,
  }
}

function normalizeSquareState(raw) {
  const state = defaultSquareState()

  if (!raw || typeof raw !== 'object') {
    return state
  }

  if (raw.pairing && typeof raw.pairing === 'object') {
    state.pairing = {
      ...state.pairing,
      ...raw.pairing,
    }
  }

  if (raw.webhook_events && typeof raw.webhook_events === 'object' && !Array.isArray(raw.webhook_events)) {
    state.webhook_events = raw.webhook_events
  }

  if (Array.isArray(raw.payments)) {
    state.payments = raw.payments
  }

  if (typeof raw.updated_at === 'string') {
    state.updated_at = raw.updated_at
  }

  return state
}

function loadSquareState() {
  ensureStateDir()

  try {
    if (fs.existsSync(SQUARE_STATE_FILE)) {
      const raw = fs.readFileSync(SQUARE_STATE_FILE, 'utf8')
      if (raw.trim().length > 0) {
        return normalizeSquareState(JSON.parse(raw))
      }
    }
  } catch (error) {
    console.error('[Square] Failed to read local state:', error)
  }

  return defaultSquareState()
}

function saveSquareState(state) {
  ensureStateDir()
  const normalized = normalizeSquareState(state)
  normalized.updated_at = new Date().toISOString()

  const tempPath = `${SQUARE_STATE_FILE}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(tempPath, SQUARE_STATE_FILE)
  return normalized
}

function updateSquarePairing(updates) {
  const state = loadSquareState()
  state.pairing = {
    ...state.pairing,
    ...updates,
    updated_at: new Date().toISOString(),
  }
  return saveSquareState(state).pairing
}

function getSquarePairing() {
  return loadSquareState().pairing
}

function getStoredPairedDeviceId() {
  const pairing = getSquarePairing()
  return pairing.device_id || null
}

function getStoredSquareCheckoutRecordByCheckoutId(checkoutId) {
  const state = loadSquareState()
  return state.payments.find((payment) => payment.square_checkout_id === checkoutId) || null
}

function getStoredSquareCheckoutRecordByPaymentId(paymentId) {
  const state = loadSquareState()
  return state.payments.find((payment) => payment.square_payment_id === paymentId) || null
}

function upsertSquarePaymentRecord(record) {
  const state = loadSquareState()
  const now = new Date().toISOString()
  const existingIndex = state.payments.findIndex(
    (payment) =>
      (record.square_checkout_id && payment.square_checkout_id === record.square_checkout_id) ||
      (record.square_payment_id && payment.square_payment_id === record.square_payment_id) ||
      (record.order_id && payment.order_id === record.order_id)
  )

  if (existingIndex >= 0) {
    state.payments[existingIndex] = {
      ...state.payments[existingIndex],
      ...record,
      updated_at: now,
    }
  } else {
    state.payments.push({
      id: record.id || `payment_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      ...record,
      created_at: record.created_at || now,
      updated_at: now,
    })
  }

  return saveSquareState(state).payments.find(
    (payment) =>
      (record.square_checkout_id && payment.square_checkout_id === record.square_checkout_id) ||
      (record.square_payment_id && payment.square_payment_id === record.square_payment_id) ||
      (record.order_id && payment.order_id === record.order_id)
  )
}

function recordSquareWebhookEvent(eventId, eventType) {
  const state = loadSquareState()
  const now = new Date().toISOString()

  if (state.webhook_events[eventId]) {
    return false
  }

  state.webhook_events[eventId] = {
    eventType,
    received_at: now,
  }

  const entries = Object.entries(state.webhook_events)
  if (entries.length > 1000) {
    entries.sort((a, b) => String(a[1].received_at).localeCompare(String(b[1].received_at)))
    state.webhook_events = Object.fromEntries(entries.slice(entries.length - 1000))
  }

  saveSquareState(state)
  return true
}

function decodeSquareSignatureKey(signatureKey) {
  const trimmed = signatureKey.trim()
  try {
    const decoded = Buffer.from(trimmed, 'base64')
    if (decoded.length > 0 && decoded.toString('base64').replace(/=+$/g, '') === trimmed.replace(/=+$/g, '')) {
      return decoded
    }
  } catch (_) {
    // Fall back to utf8 below.
  }

  return Buffer.from(trimmed, 'utf8')
}

function headerValue(headers, key) {
  const value = headers[String(key).toLowerCase()]
  if (Array.isArray(value)) {
    return value[0]
  }
  return value || undefined
}

function verifySquareWebhookSignature(rawBody, headers) {
  const signatureHeader = headerValue(headers, 'x-square-hmacsha256-signature')
  if (!signatureHeader) {
    throw new Error('Missing Square signature header')
  }

  const signatureKey = getSquareWebhookSignatureKey()
  const notificationUrl = getSquareWebhookNotificationUrl()
  const keyBytes = decodeSquareSignatureKey(signatureKey)
  const message = Buffer.concat([Buffer.from(notificationUrl, 'utf8'), rawBody])
  const expected = crypto.createHmac('sha256', keyBytes).update(message).digest('base64')

  const expectedBytes = Buffer.from(expected, 'base64')
  const signatureBytes = Buffer.from(signatureHeader.trim(), 'base64')

  if (expectedBytes.length !== signatureBytes.length) {
    return false
  }

  return crypto.timingSafeEqual(expectedBytes, signatureBytes)
}

function requestSquare(pathname, options = {}) {
  const method = options.method || 'GET'
  const version = options.version || SQUARE_DEVICE_API_VERSION
  const url = new URL(pathname, getSquareBaseUrl())

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null || value === '') {
        continue
      }
      url.searchParams.set(key, String(value))
    }
  }

  const headers = {
    Authorization: `Bearer ${getSquareAccessToken()}`,
    'Content-Type': 'application/json',
    'Square-Version': version,
    ...(options.headers || {}),
  }

  const requestInit = {
    method,
    headers,
  }

  if (options.body !== undefined) {
    requestInit.body = JSON.stringify(options.body)
  }

  return fetch(url, requestInit).then(async (response) => {
    const responseText = await response.text().catch(() => '')
    let parsed = null

    if (responseText) {
      try {
        parsed = JSON.parse(responseText)
      } catch (_) {
        parsed = { raw: responseText }
      }
    }

    if (!response.ok) {
      const details = parsed && parsed.errors && Array.isArray(parsed.errors)
        ? parsed.errors.map((error) => error.detail || error.code || error.category).filter(Boolean).join('; ')
        : responseText
      const error = new Error(details || `Square request failed with status ${response.status}`)
      error.status = response.status
      error.response = parsed
      throw error
    }

    return parsed || {}
  })
}

async function createSquareDeviceCode(input = {}) {
  const response = await requestSquare('/v2/devices/codes', {
    method: 'POST',
    version: SQUARE_DEVICE_API_VERSION,
    body: {
      idempotency_key: crypto.randomUUID(),
      device_code: {
        name: input.name || 'Atlas Front Desk',
        product_type: 'TERMINAL_API',
        location_id: input.locationId || getSquareLocationId(),
      },
    },
  })

  return response.device_code
}

async function getSquareDeviceCode(deviceCodeId) {
  const response = await requestSquare(`/v2/devices/codes/${encodeURIComponent(deviceCodeId)}`, {
    method: 'GET',
    version: SQUARE_DEVICE_API_VERSION,
  })

  return response.device_code
}

async function createSquareTerminalCheckout(input) {
  const amountCents = Number(input.amountCents)
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive integer')
  }

  const deviceId = String(input.deviceId || getStoredPairedDeviceId() || '').trim()
  if (!deviceId) {
    throw new Error('No paired Square Terminal device_id is stored')
  }

  const orderId = String(input.orderId || '').trim()
  if (!orderId) {
    throw new Error('orderId is required to create a Square Terminal checkout')
  }

  const response = await requestSquare('/v2/terminals/checkouts', {
    method: 'POST',
    version: SQUARE_TERMINAL_API_VERSION,
    body: {
      idempotency_key: crypto.randomUUID(),
      checkout: {
        amount_money: {
          amount: amountCents,
          currency: String(input.currency || 'USD').toUpperCase(),
        },
        reference_id: orderId.slice(0, 40),
        note: String(input.note || `Atlas order ${orderId}`).slice(0, 500),
        device_options: {
          device_id: deviceId,
          skip_receipt_screen: false,
        },
      },
    },
  })

  return response.checkout
}

async function getSquareTerminalCheckout(checkoutId) {
  const response = await requestSquare(`/v2/terminals/checkouts/${encodeURIComponent(checkoutId)}`, {
    method: 'GET',
    version: SQUARE_TERMINAL_API_VERSION,
  })

  return response.checkout
}

async function getSquarePayment(paymentId) {
  const response = await requestSquare(`/v2/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    version: SQUARE_PAYMENTS_API_VERSION,
  })

  return response.payment
}

function normalizeSquareCheckoutPaymentRecordFromCheckout(checkout, extra = {}) {
  return {
    order_id: checkout.reference_id || extra.order_id || null,
    amount_cents: checkout.amount_money?.amount ?? extra.amount_cents ?? null,
    currency: checkout.amount_money?.currency || extra.currency || 'USD',
    square_checkout_id: checkout.id || extra.square_checkout_id || null,
    square_payment_id: extra.square_payment_id || null,
    device_id: checkout.device_options?.device_id || extra.device_id || null,
    status: checkout.status || extra.status || null,
    created_at: checkout.created_at || extra.created_at || new Date().toISOString(),
    updated_at: checkout.updated_at || extra.updated_at || new Date().toISOString(),
  }
}

function normalizeSquareCheckoutPaymentRecordFromPayment(payment, checkout = {}) {
  return {
    order_id: checkout.reference_id || payment.reference_id || null,
    amount_cents: payment.amount_money?.amount ?? checkout.amount_money?.amount ?? null,
    currency: payment.amount_money?.currency || checkout.amount_money?.currency || 'USD',
    square_checkout_id: payment.terminal_checkout_id || checkout.id || null,
    square_payment_id: payment.id || null,
    device_id: checkout.device_options?.device_id || null,
    status: payment.status || checkout.status || null,
    created_at: payment.created_at || checkout.created_at || new Date().toISOString(),
    updated_at: payment.updated_at || checkout.updated_at || new Date().toISOString(),
  }
}

function applyPairedDeviceCodeFromWebhook(payload) {
  const merchantId = payload.merchant_id || null
  const locationId = payload.location_id || null
  const deviceCode = payload.data?.object?.device_code

  if (!deviceCode) {
    return null
  }

  return updateSquarePairing({
    merchant_id: merchantId,
    location_id: locationId || deviceCode.location_id || null,
    device_code_id: deviceCode.id || null,
    device_code: deviceCode.code || null,
    device_id: deviceCode.device_id || null,
    status: deviceCode.status || 'PAIRED',
    pair_by: deviceCode.pair_by || null,
    created_at: deviceCode.created_at || null,
    paired_at: deviceCode.paired_at || deviceCode.status_changed_at || null,
  })
}

async function applyTerminalCheckoutWebhook(payload) {
  const checkout = payload.data?.object?.checkout
  if (!checkout) {
    return null
  }

  const record = normalizeSquareCheckoutPaymentRecordFromCheckout(checkout)

  if (Array.isArray(checkout.payment_ids) && checkout.payment_ids.length > 0) {
    record.square_payment_id = checkout.payment_ids[0]

    try {
      const payment = await getSquarePayment(checkout.payment_ids[0])
      Object.assign(record, normalizeSquareCheckoutPaymentRecordFromPayment(payment, checkout))
    } catch (error) {
      console.error('[Square] Failed to fetch payment details:', error)
    }
  }

  return upsertSquarePaymentRecord(record)
}

module.exports = {
  getSquareEnvironment,
  getSquareBaseUrl,
  getSquareAccessToken,
  getSquareLocationId,
  getSquareWebhookSignatureKey,
  getSquareWebhookNotificationUrl,
  loadSquareState,
  saveSquareState,
  updateSquarePairing,
  getSquarePairing,
  getStoredPairedDeviceId,
  getStoredSquareCheckoutRecordByCheckoutId,
  getStoredSquareCheckoutRecordByPaymentId,
  upsertSquarePaymentRecord,
  recordSquareWebhookEvent,
  verifySquareWebhookSignature,
  createSquareDeviceCode,
  getSquareDeviceCode,
  createSquareTerminalCheckout,
  getSquareTerminalCheckout,
  getSquarePayment,
  normalizeSquareCheckoutPaymentRecordFromCheckout,
  normalizeSquareCheckoutPaymentRecordFromPayment,
  applyPairedDeviceCodeFromWebhook,
  applyTerminalCheckoutWebhook,
}
