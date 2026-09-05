/**
 * A/B switch for Gemini's thinking level.
 *
 * TEST-ONLY SCAFFOLDING. The default is `baseline`, which produces exactly the
 * generation config Atlas has always used — no `thinkingConfig` key is sent at
 * all, so variant A is byte-identical to the pre-existing request body.
 *
 * Switch with NEXT_PUBLIC_ATLAS_THINKING_LEVEL=minimal in .env.local (the
 * NEXT_PUBLIC_ prefix is deliberate: the value is read on the server to build
 * the request, and on the client purely to label latency logs).
 *
 * The streaming route also accepts a per-request `thinkingLevel` override so an
 * A/B harness can alternate variants without restarting the server. Nothing in
 * the app sends it; when it is absent the env default applies.
 */

export type ThinkingVariant = 'baseline' | 'minimal'

export const THINKING_VARIANTS: ThinkingVariant[] = ['baseline', 'minimal']

/** Generation config Atlas has always used. Do not change: this is variant A. */
const BASE_GENERATION_CONFIG = {
  maxOutputTokens: 1024,
  temperature: 0.7,
}

function isThinkingVariant(value: unknown): value is ThinkingVariant {
  return typeof value === 'string' && (THINKING_VARIANTS as string[]).includes(value)
}

/**
 * The configured default. Anything unrecognised falls back to baseline, so a
 * typo in .env.local can never silently change Atlas's behaviour.
 */
export function defaultThinkingVariant(): ThinkingVariant {
  const configured = process.env.NEXT_PUBLIC_ATLAS_THINKING_LEVEL
  return isThinkingVariant(configured) ? configured : 'baseline'
}

/** Resolve a variant, honouring an explicit per-request override if it is valid. */
export function resolveThinkingVariant(override?: unknown): ThinkingVariant {
  return isThinkingVariant(override) ? override : defaultThinkingVariant()
}

/**
 * Build the Gemini generationConfig for a variant.
 *
 * baseline: `{ maxOutputTokens, temperature }` — unchanged from before this A/B.
 * minimal:  the same, plus `thinkingConfig: { thinkingLevel: 'minimal' }`.
 *
 * Note that `thinkingBudget: 0` is rejected by this model with a 400; the
 * thinkingLevel enum is the supported control.
 */
export function buildGenerationConfig(variant: ThinkingVariant): Record<string, unknown> {
  if (variant === 'minimal') {
    return {
      ...BASE_GENERATION_CONFIG,
      thinkingConfig: { thinkingLevel: 'minimal' },
    }
  }
  return { ...BASE_GENERATION_CONFIG }
}
