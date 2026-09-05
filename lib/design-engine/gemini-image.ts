/**
 * SERVER ONLY. Calls the Gemini image models.
 *
 * This module reads GEMINI_API_KEY and must never be imported from anything
 * that reaches the browser — the client-side generator talks to
 * /api/design-requests/generate instead, which is the only caller of this file.
 *
 * Verified against the live API before implementing:
 *   POST /v1beta/models/<model>:generateContent
 *   { contents:[{role:'user',parts:[{text}, {inlineData:{mimeType,data}}]}],
 *     generationConfig:{ responseModalities:['IMAGE'], imageConfig:{ aspectRatio } } }
 * returns candidates[0].content.parts[].inlineData { mimeType:'image/jpeg', data:<base64> }.
 * Aspect ratio is honoured: 16:9 -> 1376x768, 3:2 -> 1264x848.
 */

/**
 * Default model. `gemini-3-pro-image` is documented as the professional design
 * engine with precise text rendering, which is what a card covered in contact
 * details needs — an illegible phone number makes the whole card worthless.
 * Override with ATLAS_DESIGN_MODEL to trade quality for speed
 * (e.g. gemini-3.1-flash-image).
 */
const DEFAULT_DESIGN_MODEL = 'gemini-3-pro-image'

const GENERATION_TIMEOUT_MS = 180_000

export interface ReferenceImage {
  mimeType: string
  data: Buffer
}

export interface GeneratedImage {
  mimeType: string
  data: Buffer
  model: string
}

export class DesignGenerationError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message)
    this.name = 'DesignGenerationError'
  }
}

export function getDesignModel(): string {
  const configured = process.env.ATLAS_DESIGN_MODEL?.trim()
  return configured && configured.length > 0 ? configured : DEFAULT_DESIGN_MODEL
}

/**
 * Generates one surface image.
 *
 * Reference images (the customer's logo) are passed as inline data so the model
 * can match the design to it. Only bytes we already fetched from our own
 * storage are ever sent — never a URL supplied by anyone.
 */
export async function generateSurfaceImage(options: {
  prompt: string
  aspectRatio: string
  references?: ReferenceImage[]
  signal?: AbortSignal
}): Promise<GeneratedImage> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new DesignGenerationError('GEMINI_API_KEY is not configured')
  }

  const model = getDesignModel()

  const parts: Array<Record<string, unknown>> = [{ text: options.prompt }]
  for (const reference of options.references ?? []) {
    parts.push({
      inlineData: { mimeType: reference.mimeType, data: reference.data.toString('base64') },
    })
  }

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), GENERATION_TIMEOUT_MS)
  const onAbort = () => timeout.abort()
  options.signal?.addEventListener('abort', onAbort)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: options.aspectRatio },
          },
        }),
        signal: timeout.signal,
      }
    )

    const raw = await response.text()

    if (!response.ok) {
      // Logged server-side only; the customer never sees an upstream message,
      // which could otherwise echo the request or the key.
      let upstream = raw.slice(0, 500)
      try {
        upstream = JSON.parse(raw)?.error?.message ?? upstream
      } catch {
        // keep the raw snippet
      }
      throw new DesignGenerationError(`Image model returned ${response.status}`, upstream)
    }

    const parsed = JSON.parse(raw || '{}')
    const candidate = parsed.candidates?.[0]
    const imagePart = candidate?.content?.parts?.find(
      (part: any) => part?.inlineData?.data && String(part.inlineData.mimeType ?? '').startsWith('image/')
    )

    if (!imagePart) {
      throw new DesignGenerationError('Image model returned no image', {
        finishReason: candidate?.finishReason,
        promptFeedback: parsed.promptFeedback,
      })
    }

    return {
      mimeType: imagePart.inlineData.mimeType,
      data: Buffer.from(imagePart.inlineData.data, 'base64'),
      model,
    }
  } catch (error) {
    if (error instanceof DesignGenerationError) throw error
    if ((error as Error)?.name === 'AbortError') {
      throw new DesignGenerationError('Image generation timed out or was cancelled')
    }
    throw new DesignGenerationError('Image generation failed', error)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
