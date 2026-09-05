/**
 * Where the design engine plugs in.
 *
 * Phase 2 builds the workspace and the lifecycle only. No generator is
 * registered yet, so `startDesignGeneration` walks a request as far as
 * "understanding your business" and then stops and says so, rather than
 * fabricating a finished design. When the Gemini engine arrives it implements
 * `DesignGenerator`, is registered once at startup, and nothing in the UI or
 * the state machine has to change.
 */

import { applyGenerationState } from './state'
import type { DesignGenerationState } from './state'
import type { DesignDocument, DesignSurface, SurfaceRole } from './types'
import type { DesignRequestRecord } from '../design-requests/types'

/** How a generator reports progress back to the workspace. */
export interface DesignGenerationHooks {
  /** Move the whole job to a new state. */
  onState: (state: DesignGenerationState) => void
  /**
   * Fill in one surface. A generator calls this with `content` (and optionally
   * a flattened `previewUrl`) as each side finishes.
   */
  onSurface: (
    role: SurfaceRole,
    patch: Partial<Omit<DesignSurface, 'role' | 'label'>>
  ) => void
}

export interface DesignGenerator {
  readonly name: string
  /**
   * Produce every surface the document requires. For a business card that
   * means both the front and the back — a generator that fills in only the
   * front leaves the job incomplete, and the workspace will show it as such.
   */
  generate(
    request: DesignRequestRecord,
    document: DesignDocument,
    hooks: DesignGenerationHooks,
    signal: AbortSignal
  ): Promise<void>
}

let registeredGenerator: DesignGenerator | null = null

/** Called once at startup by the future Gemini design engine. */
export function registerDesignGenerator(generator: DesignGenerator): void {
  registeredGenerator = generator
}

export function getDesignGenerator(): DesignGenerator | null {
  return registeredGenerator
}

export type StartResult =
  | { started: true }
  | { started: false; reason: 'no-generator' }
  | { started: false; reason: 'failed' }

/**
 * Runs a request through the design engine.
 *
 * The states before the engine takes over are handled here so every path
 * reports progress the same way.
 */
export async function startDesignGeneration(
  request: DesignRequestRecord,
  document: DesignDocument,
  hooks: DesignGenerationHooks,
  signal: AbortSignal
): Promise<StartResult> {
  hooks.onState('received')
  hooks.onState('analyzing')

  const generator = registeredGenerator
  if (!generator) {
    // Deliberately stops here. Showing "your design is ready" with nothing
    // behind it would be a lie told to a customer standing at the kiosk.
    console.log('[Design Engine] No generator registered; holding at "analyzing"')
    return { started: false, reason: 'no-generator' }
  }

  try {
    await generator.generate(request, document, hooks, signal)
    return { started: true }
  } catch (error) {
    if (signal.aborted) return { started: true }
    console.error(`[Design Engine] Generator "${generator.name}" failed:`, error)
    hooks.onState('error')
    return { started: false, reason: 'failed' }
  }
}

/**
 * Walks the state machine so every screen of the workspace can be seen and
 * reviewed without a design engine.
 *
 * This is a UI preview, used only behind ?preview=states. It never writes
 * surface content, so the previews stay honest skeletons — it demonstrates the
 * states, it does not pretend a design was made.
 */
export async function previewStateWalkthrough(
  document: DesignDocument,
  hooks: DesignGenerationHooks,
  signal: AbortSignal,
  stepMs = 1800
): Promise<void> {
  const { sequenceFor } = await import('./state')

  for (const state of sequenceFor(document)) {
    if (signal.aborted) return
    hooks.onState(state)
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
}

/** Re-exported so callers can keep document and state in step in one call. */
export { applyGenerationState }
