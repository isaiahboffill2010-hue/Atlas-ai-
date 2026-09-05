/**
 * The real design generator, plugged into the Phase 2A seam.
 *
 * It contains no Gemini credentials and makes no Gemini calls itself: it asks
 * /api/design-requests/generate for one surface at a time and reports progress
 * through the existing hooks, so the existing state machine stays the single
 * source of truth for what the customer sees.
 *
 * Surfaces are generated one at a time, in order, so the front appears while
 * the back is still being made.
 */

import { requiredRoles } from './types'
import type { SurfaceContent, SurfaceRole, DesignDocument } from './types'
import type { DesignGenerator, DesignGenerationHooks } from './generator'
import type { DesignGenerationState } from './state'
import type { DesignRequestRecord } from '../design-requests/types'

export interface SurfaceResult {
  storageKey: string
  previewUrl: string | null
  content: SurfaceContent
  assetUrls: Record<string, string>
}

/** How a surface is produced. Injectable so the generator is testable. */
export type SurfaceRenderer = (
  input: { requestId: string; role: SurfaceRole; attempt: number },
  signal: AbortSignal
) => Promise<SurfaceResult>

/** Called as each surface's assets become available, for signed URL bookkeeping. */
export type AssetUrlSink = (urls: Record<string, string>) => void

/** The state to enter while a surface is being made, and once it is done. */
const SURFACE_STATES: Record<SurfaceRole, { designing: DesignGenerationState; done: DesignGenerationState }> = {
  front: { designing: 'designing_front', done: 'front_complete' },
  back: { designing: 'designing_back', done: 'back_complete' },
  flyer: { designing: 'designing_flyer', done: 'flyer_complete' },
}

/** Talks to the server route. The API key lives there, never here. */
export const fetchSurfaceFromServer: SurfaceRenderer = async (input, signal) => {
  const response = await fetch('/api/design-requests/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })

  if (!response.ok) {
    // The server has already logged the detail; nothing from upstream is
    // surfaced here.
    throw new Error(`Surface generation failed (${response.status})`)
  }

  return (await response.json()) as SurfaceResult
}

export function createGeminiDesignGenerator(options: {
  renderSurface?: SurfaceRenderer
  onAssetUrls?: AssetUrlSink
} = {}): DesignGenerator {
  const renderSurface = options.renderSurface ?? fetchSurfaceFromServer

  return {
    name: 'gemini-design-engine',

    async generate(
      request: DesignRequestRecord,
      document: DesignDocument,
      hooks: DesignGenerationHooks,
      signal: AbortSignal
    ): Promise<void> {
      // For a business card this is ['front', 'back'] — both are generated
      // before the design is finished, and a failure on either throws rather
      // than letting the job reach `complete`.
      const roles = requiredRoles(request.design_type)

      for (const role of roles) {
        if (signal.aborted) return

        const states = SURFACE_STATES[role]
        hooks.onState(states.designing)
        hooks.onSurface(role, { status: 'designing', errorMessage: null })

        try {
          const result = await renderSurface({ requestId: request.id, role, attempt: 1 }, signal)

          if (signal.aborted) return

          options.onAssetUrls?.(result.assetUrls ?? {})

          hooks.onSurface(role, {
            status: 'complete',
            content: result.content,
            previewUrl: result.previewUrl,
            errorMessage: null,
          })
          hooks.onState(states.done)
        } catch (error) {
          if (signal.aborted) return

          console.error(`[Design Engine] ${role} generation failed:`, error)
          hooks.onSurface(role, {
            status: 'error',
            errorMessage: 'This side could not be created.',
          })
          // Rethrown so startDesignGeneration reports the job as failed. A
          // business card with one good side is not a finished business card.
          throw error instanceof Error ? error : new Error('Surface generation failed')
        }
      }

      if (signal.aborted) return

      hooks.onState('preview')
      hooks.onState('complete')
    },
  }
}
