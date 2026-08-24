export type SquareEnvironment = 'sandbox' | 'production'

export interface SquareDeviceCode {
  id?: string
  name?: string
  code?: string
  product_type?: string
  location_id?: string
  created_at?: string
  pair_by?: string
  status?: string
  device_id?: string
  status_changed_at?: string
  paired_at?: string
}

export interface SquareTerminalCheckout {
  id?: string
  amount_money?: {
    amount?: number
    currency?: string
  }
  reference_id?: string
  note?: string
  device_options?: {
    device_id?: string
    skip_receipt_screen?: boolean
  }
  status?: string
  location_id?: string
  created_at?: string
  updated_at?: string
  payment_ids?: string[]
  payment_type?: string
  deadline_duration?: string
}

export interface SquarePayment {
  id?: string
  created_at?: string
  updated_at?: string
  amount_money?: {
    amount?: number
    currency?: string
  }
  status?: string
  reference_id?: string
  terminal_checkout_id?: string
  note?: string
}

export interface SquarePairingRecord {
  merchant_id: string | null
  location_id: string | null
  device_code_id: string | null
  device_code: string | null
  device_name: string | null
  device_id: string | null
  status: string | null
  pair_by: string | null
  created_at: string | null
  updated_at: string | null
  paired_at: string | null
}

export interface SquarePaymentRecord {
  id?: string
  order_id: string | null
  amount_cents: number | null
  currency: string
  square_checkout_id: string | null
  square_payment_id: string | null
  device_id: string | null
  status: string | null
  created_at: string
  updated_at: string
}

export interface SquareState {
  pairing: SquarePairingRecord
  webhook_events: Record<string, { eventType: string; received_at: string }>
  payments: SquarePaymentRecord[]
  updated_at: string | null
}

export interface CreateSquareDeviceCodeInput {
  name?: string
  locationId?: string
}

export interface CreateSquareTerminalCheckoutInput {
  amountCents: number
  orderId: string
  deviceId?: string
  currency?: string
  note?: string
}

export function getSquareEnvironment(): SquareEnvironment
export function getSquareBaseUrl(): string
export function getSquareAccessToken(): string
export function getSquareLocationId(): string
export function getSquareWebhookSignatureKey(): string
export function getSquareWebhookNotificationUrl(): string
export function loadSquareState(): SquareState
export function saveSquareState(state: SquareState): SquareState
export function updateSquarePairing(updates: Partial<SquarePairingRecord>): SquarePairingRecord
export function getSquarePairing(): SquarePairingRecord
export function getStoredPairedDeviceId(): string | null
export function getStoredSquareCheckoutRecordByCheckoutId(
  checkoutId: string
): SquarePaymentRecord | null
export function getStoredSquareCheckoutRecordByPaymentId(
  paymentId: string
): SquarePaymentRecord | null
export function upsertSquarePaymentRecord(record: Partial<SquarePaymentRecord>): SquarePaymentRecord | undefined
export function recordSquareWebhookEvent(eventId: string, eventType: string): boolean
export function verifySquareWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean
export function createSquareDeviceCode(input?: CreateSquareDeviceCodeInput): Promise<SquareDeviceCode>
export function getSquareDeviceCode(deviceCodeId: string): Promise<SquareDeviceCode>
export function createSquareTerminalCheckout(input: CreateSquareTerminalCheckoutInput): Promise<SquareTerminalCheckout>
export function getSquareTerminalCheckout(checkoutId: string): Promise<SquareTerminalCheckout>
export function getSquarePayment(paymentId: string): Promise<SquarePayment>
export function normalizeSquareCheckoutPaymentRecordFromCheckout(
  checkout: SquareTerminalCheckout,
  extra?: Record<string, unknown>
): Partial<SquarePaymentRecord>
export function normalizeSquareCheckoutPaymentRecordFromPayment(
  payment: SquarePayment,
  checkout?: SquareTerminalCheckout
): Partial<SquarePaymentRecord>
export function applyPairedDeviceCodeFromWebhook(payload: any): SquarePairingRecord | null
export function applyTerminalCheckoutWebhook(payload: any): Promise<SquarePaymentRecord | null>
