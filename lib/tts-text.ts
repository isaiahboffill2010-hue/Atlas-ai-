/**
 * Markdown cleanup for spoken text.
 *
 * Gemini sometimes formats answers with Markdown ("**$0.75 per page**", bullet
 * lists, headings). That is harmless on screen but goes straight into
 * ElevenLabs, which either voices the asterisks or mangles the prosody around
 * them. This strips the formatting while leaving the wording untouched.
 *
 * Scope, deliberately narrow:
 *  - ONLY applied to text on its way to TTS. The response text that is stored,
 *    logged, or displayed is never passed through this.
 *  - Removes formatting characters only. It does not rephrase, reorder, or
 *    re-punctuate anything, because punctuation drives speech prosody.
 *  - Sentence boundaries and normal punctuation are preserved exactly.
 */

/**
 * Strip stray emphasis asterisks, but leave a "*" that is being used as a
 * multiplication sign between numbers (e.g. "8.5 * 11").
 */
function stripStrayAsterisks(text: string): string {
  return text.replace(/\*+/g, (match, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 4), offset)
    const after = whole.slice(offset + match.length, offset + match.length + 4)
    if (/\d\s*$/.test(before) && /^\s*\d/.test(after)) return match
    return ''
  })
}

export function stripMarkdownForSpeech(text: string): string {
  if (!text) return ''

  let out = text

  // Fenced code blocks -> their contents.
  out = out.replace(/```[a-zA-Z0-9+-]*\r?\n?([\s\S]*?)```/g, '$1')

  // Inline code -> its contents.
  out = out.replace(/`([^`\n]+)`/g, '$1')

  // Links and images -> the visible label. Reading a URL aloud is unbearable.
  out = out.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')

  // Bold / italic / bold-italic.
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1')
  out = out.replace(/\*([^*\n]+)\*/g, '$1')
  out = out.replace(/___([^_]+)___/g, '$1')
  out = out.replace(/__([^_]+)__/g, '$1')
  // Underscore italics only at word boundaries, so snake_case survives.
  out = out.replace(/(^|[\s([{])_([^_\n]+)_(?=[\s).,!?;:\]}]|$)/g, '$1$2')

  // Horizontal rules -> gone (before bullet handling, which would eat "---").
  out = out.replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, '')

  // Headings -> just the heading text.
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, '')

  // Blockquote markers.
  out = out.replace(/^[ \t]*>[ \t]?/gm, '')

  // Unordered list markers at the start of a line. Numbered lists are left
  // alone: "1. Standard paper" reads naturally out loud.
  out = out.replace(/^[ \t]*[*+•-][ \t]+/gm, '')

  // Any emphasis characters left over, e.g. a "**" whose partner landed in the
  // next chunk.
  out = stripStrayAsterisks(out)

  // Tidy whitespace only. No punctuation is added, removed, or moved.
  out = out.replace(/[ \t]+$/gm, '')
  out = out.replace(/\n{3,}/g, '\n\n')

  return out.trim()
}
