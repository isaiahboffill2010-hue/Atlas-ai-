export interface FrontDeskConfig {
  enabled: boolean
  simulatePerson: boolean
  personConfirmationMs: number
  personAbsenceMs: number
  greetingCooldownMs: number
  detectionIntervalMs: number
  personConfidenceThreshold: number
  cameraWidth: number
  cameraHeight: number
  cameraReconnectMs: number
}

function readBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value == null) return defaultValue
  return value.toLowerCase() === 'true'
}

function readNumber(value: string | undefined, defaultValue: number): number {
  if (value == null || value.trim() === '') return defaultValue
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

export const frontDeskConfig: FrontDeskConfig = {
  enabled: readBoolean(process.env.NEXT_PUBLIC_FRONT_DESK_MODE),
  simulatePerson: readBoolean(process.env.NEXT_PUBLIC_FRONT_DESK_SIMULATE_PERSON),
  personConfirmationMs: readNumber(process.env.NEXT_PUBLIC_FRONT_DESK_PERSON_CONFIRMATION_MS, 1000),
  personAbsenceMs: readNumber(process.env.NEXT_PUBLIC_FRONT_DESK_PERSON_ABSENCE_MS, 5000),
  greetingCooldownMs: readNumber(process.env.NEXT_PUBLIC_FRONT_DESK_GREETING_COOLDOWN_MS, 10000),
  detectionIntervalMs: readNumber(process.env.NEXT_PUBLIC_FRONT_DESK_DETECTION_INTERVAL_MS, 700),
  personConfidenceThreshold: readNumber(process.env.NEXT_PUBLIC_FRONT_DESK_PERSON_CONFIDENCE_THRESHOLD, 0.65),
  cameraWidth: readNumber(process.env.NEXT_PUBLIC_FRONT_DESK_CAMERA_WIDTH, 640),
  cameraHeight: readNumber(process.env.NEXT_PUBLIC_FRONT_DESK_CAMERA_HEIGHT, 360),
  cameraReconnectMs: readNumber(process.env.NEXT_PUBLIC_FRONT_DESK_CAMERA_RECONNECT_MS, 5000),
}

export type FrontDeskCameraStatus = 'disabled' | 'initializing' | 'connected' | 'unavailable' | 'reconnecting' | 'simulated'
export type FrontDeskPersonStatus = 'unknown' | 'clear' | 'detected'

export interface FrontDeskDebugState {
  cameraStatus: FrontDeskCameraStatus
  personStatus: FrontDeskPersonStatus
  frontDeskActive: boolean
  message: string
}

export const defaultFrontDeskDebugState: FrontDeskDebugState = {
  cameraStatus: 'disabled',
  personStatus: 'unknown',
  frontDeskActive: false,
  message: 'Front desk mode disabled',
}
