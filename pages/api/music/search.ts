import type { NextApiRequest, NextApiResponse } from 'next'

interface SearchResult {
  videoId: string
  title: string
  channel: string
  thumbnail: string
}

interface SearchResponse {
  success?: boolean
  result?: SearchResult
  error?: string
}

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY

if (!YOUTUBE_API_KEY) {
  console.error('[Music] YOUTUBE_API_KEY not found in environment variables')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SearchResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { query } = req.body

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Query is required' })
  }

  if (!YOUTUBE_API_KEY) {
    console.error('[Music] YOUTUBE_API_KEY not configured')
    return res.status(500).json({ error: 'YouTube API not configured' })
  }

  try {
    console.log(`[Music] Searching YouTube for: "${query}"`)

    // Search YouTube for the song
    const searchResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=10&key=${YOUTUBE_API_KEY}&safeSearch=none&order=relevance`
    )

    if (!searchResponse.ok) {
      console.error(`[Music] YouTube API error: ${searchResponse.status}`)
      return res.status(500).json({ error: 'YouTube search failed' })
    }

    const data = await searchResponse.json()

    if (!data.items || data.items.length === 0) {
      console.log(`[Music] No results found for: "${query}"`)
      return res.status(404).json({ error: `No results found for "${query}"` })
    }

    // Score and select the best result
    const bestResult = selectBestResult(data.items, query)

    if (!bestResult) {
      console.log(`[Music] Could not find relevant result for: "${query}"`)
      return res.status(404).json({ error: `Could not find relevant result for "${query}"` })
    }

    console.log(`[Music] Found: "${bestResult.title}" by ${bestResult.channel}`)

    return res.status(200).json({
      success: true,
      result: bestResult,
    })
  } catch (error) {
    console.error('[Music] Search error:', error)
    return res.status(500).json({ error: 'Search failed' })
  }
}

function selectBestResult(items: any[], query: string): SearchResult | null {
  if (!items || items.length === 0) {
    return null
  }

  // Score each result based on relevance
  const scoredResults = items
    .map((item) => {
      const snippet = item.snippet
      const title = snippet.title || ''
      const channel = snippet.channelTitle || ''

      let score = 0

      // Exact title match
      if (title.toLowerCase() === query.toLowerCase()) {
        score += 1000
      }

      // Title contains all query words
      const queryWords = query.toLowerCase().split(/\s+/)
      const titleLower = title.toLowerCase()
      const matchedWords = queryWords.filter((word) => titleLower.includes(word)).length
      score += matchedWords * 100

      // Official channels (Music, Artist, VEVO, Official)
      if (
        channel.toLowerCase().includes('official') ||
        channel.toLowerCase().includes('music') ||
        channel.toLowerCase().includes('vevo')
      ) {
        score += 200
      }

      // Penalize if title seems unrelated
      if (
        title.toLowerCase().includes('cover') &&
        !query.toLowerCase().includes('cover')
      ) {
        score -= 50
      }

      if (
        title.toLowerCase().includes('remix') &&
        !query.toLowerCase().includes('remix')
      ) {
        score -= 50
      }

      return {
        item,
        score,
        title,
        channel,
      }
    })
    .sort((a, b) => b.score - a.score)

  if (scoredResults.length === 0) {
    return null
  }

  const best = scoredResults[0]
  console.log(
    `[Music] Selected result (score: ${best.score}): "${best.title}" by ${best.channel}`
  )

  return {
    videoId: best.item.id.videoId,
    title: best.title,
    channel: best.channel,
    thumbnail: best.item.snippet.thumbnails?.default?.url || '',
  }
}
