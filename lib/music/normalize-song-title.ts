/**
 * Normalize a song title for consistent duplicate detection
 * - Convert to lowercase
 * - Trim leading/trailing whitespace
 * - Collapse multiple spaces to single space
 *
 * Examples:
 * - "Numb" -> "numb"
 * - "NUMB" -> "numb"
 * - "numb" -> "numb"
 * - " Numb " -> "numb"
 * - "Numb  (Radio Edit)" -> "numb  (radio edit)" -> "numb (radio edit)"
 */
export function normalizeSongTitle(title: string): string {
  if (!title || typeof title !== 'string') {
    return ''
  }

  return (
    title
      .trim() // Remove leading/trailing whitespace
      .toLowerCase() // Convert to lowercase
      .replace(/\s+/g, ' ') // Collapse multiple spaces to single space
  )
}
