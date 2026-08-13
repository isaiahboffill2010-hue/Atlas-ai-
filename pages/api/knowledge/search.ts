import type { NextApiRequest, NextApiResponse } from 'next'
import { retrieveKnowledge, formatKnowledgeContext } from '../../../lib/knowledge/knowledge-retriever'

interface SearchResponse {
  query: string
  resultsCount: number
  knowledgeContext?: string
  formattedContext?: string
  error?: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SearchResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ query: '', resultsCount: 0, error: 'Method not allowed' })
  }

  const { query } = req.body

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ query: '', resultsCount: 0, error: 'Query is required' })
  }

  try {
    console.log(`[KnowledgeSearch] Testing query: ${query}`)

    const retrieved = await retrieveKnowledge(query)
    const formatted = formatKnowledgeContext(retrieved)

    console.log(`[KnowledgeSearch] Found ${retrieved.length} relevant documents`)

    return res.status(200).json({
      query,
      resultsCount: retrieved.length,
      knowledgeContext: formatted,
      formattedContext: formatted,
    })
  } catch (error) {
    console.error('[KnowledgeSearch] Error:', error)
    return res.status(500).json({
      query,
      resultsCount: 0,
      error: 'Search failed',
    })
  }
}
