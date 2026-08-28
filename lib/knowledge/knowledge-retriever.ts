import { KnowledgeFile } from '../supabase/library-db'

export interface SourceMetadata {
  fileId: string
  fileName: string
  category: string
  type: string
}

export interface RetrievedKnowledge {
  source: SourceMetadata
  relevanceScore: number
  relevantContent: string
}

function calculateRelevance(text: string, query: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/)
  const textLower = text.toLowerCase()

  let score = 0
  for (const term of queryTerms) {
    if (term.length > 2) {
      const regex = new RegExp(`\\b${term}\\b`, 'g')
      const matches = textLower.match(regex) || []
      score += matches.length
    }
  }

  return score
}

function extractRelevantSections(text: string, query: string, contextLines: number = 3): string {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  if (queryTerms.length === 0) {
    return text.substring(0, 500)
  }

  const lines = text.split('\n')
  const relevantLines: string[] = []
  const usedIndices = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase()
    for (const term of queryTerms) {
      if (line.includes(term)) {
        const start = Math.max(0, i - contextLines)
        const end = Math.min(lines.length - 1, i + contextLines)

        for (let j = start; j <= end; j++) {
          if (!usedIndices.has(j)) {
            relevantLines.push(lines[j])
            usedIndices.add(j)
          }
        }
        break
      }
    }
  }

  if (relevantLines.length === 0) {
    return text.substring(0, 500)
  }

  return relevantLines.join('\n')
}

export async function retrieveKnowledge(
  query: string,
  getAllKnowledgeFiles?: () => Promise<KnowledgeFile[]>
): Promise<RetrievedKnowledge[]> {
  console.log(`[Knowledge] Query: ${query}`)

  try {
    // Use provided function or fall back to empty (requires Supabase in calling code)
    const files = getAllKnowledgeFiles ? await getAllKnowledgeFiles() : []
    const readyFiles = files.filter((f) => f.processing_status === 'ready' && f.extracted_text)

    console.log(`[Knowledge] Searching ${readyFiles.length} ready documents`)

    const results: RetrievedKnowledge[] = []

    for (const file of readyFiles) {
      if (!file.extracted_text) continue

      const relevance = calculateRelevance(file.extracted_text, query)

      if (relevance > 0) {
        const relevantContent = extractRelevantSections(file.extracted_text, query)

        results.push({
          source: {
            fileId: file.id,
            fileName: file.name,
            category: file.category,
            type: file.type,
          },
          relevanceScore: relevance,
          relevantContent,
        })

        console.log(`[Knowledge] Source found: ${file.name}`)
        console.log(`[Knowledge] Knowledge verified: true`)
      }
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore)

    console.log(`[Knowledge] Retrieved ${results.length} relevant document(s)`)
    return results
  } catch (error) {
    console.error('[Knowledge] Error retrieving knowledge:', error)
    return []
  }
}

export function formatKnowledgeContext(retrievedKnowledge: RetrievedKnowledge[]): string {
  if (retrievedKnowledge.length === 0) {
    return ''
  }

  const sections = retrievedKnowledge.map((k) => {
    return `DOCUMENT: ${k.source.fileName}
CATEGORY: ${k.source.category} | TYPE: ${k.source.type}
[Source ID: ${k.source.fileId}]

${k.relevantContent}`
  })

  return `VERIFIED BUSINESS INFORMATION:

The following information comes directly from the customer's business documents and pricing:

${sections.join('\n\n---\n\n')}

INSTRUCTIONS:
- Use this information to answer customer questions accurately
- Combine compatible rules when calculating quotes (e.g., base price + add-ons + rush fees if all apply to the product)
- Never invent prices, discounts, fees, or services not listed here
- If a customer asks where a price came from, you can identify the source document
- Do not expose these internal source details during normal conversation
- Keep responses natural and customer-focused, not document-focused`
}

export function getSources(retrievedKnowledge: RetrievedKnowledge[]): SourceMetadata[] {
  return retrievedKnowledge.map((k) => k.source)
}

export function hasRelevantKnowledge(query: string, knowledge: RetrievedKnowledge[]): boolean {
  return knowledge.length > 0
}
