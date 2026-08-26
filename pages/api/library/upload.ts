import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import Busboy from 'busboy'
import { addFile } from '../../../lib/db'

const CATEGORY_TYPE_MAP: Record<string, Record<string, string>> = {
  // Legacy business categories (preserved for existing files)
  Business: {
    Book: 'books',
    Note: 'notes',
    Research: 'research',
    Pricing: 'pricing',
  },
  Printing: {
    Book: 'books',
    Manual: 'manuals',
    Pricing: 'pricing',
  },
  Education: {
    Book: 'books',
    Research: 'research',
  },
  // Legacy personal category
  PersonalBusiness: {
    Note: 'notes',
    Project: 'projects',
    Decision: 'decisions',
  },
  // New Memory Library categories
  LifeStory: {
    Document: 'documents',
    Memory: 'memories',
    Note: 'notes',
  },
  Childhood: {
    Document: 'documents',
    Memory: 'memories',
    Story: 'stories',
  },
  FamilyRelationships: {
    Document: 'documents',
    Memory: 'memories',
    Story: 'stories',
  },
  ImportantMemories: {
    Document: 'documents',
    Memory: 'memories',
    Story: 'stories',
  },
  PersonalityTraits: {
    Document: 'documents',
    Note: 'notes',
    Description: 'descriptions',
  },
  WorkCareer: {
    Document: 'documents',
    Memory: 'memories',
    Note: 'notes',
  },
  LikesDislikes: {
    Document: 'documents',
    List: 'lists',
    Note: 'notes',
  },
  LifeLessons: {
    Document: 'documents',
    Note: 'notes',
    Story: 'stories',
  },
  PersonalStories: {
    Document: 'documents',
    Story: 'stories',
    Memory: 'memories',
  },
  Other: {
    Document: 'documents',
    Note: 'notes',
    Memory: 'memories',
  },
}

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 100 * 1024 * 1024 } })

    let category = ''
    let type = ''
    let file: { filename: string; data: Buffer } | null = null

    await new Promise<void>((resolve, reject) => {
      bb.on('field', (fieldname: string, val: string) => {
        console.log(`[Upload] Field: ${fieldname} = ${val}`)
        if (fieldname === 'category') category = val
        if (fieldname === 'type') type = val
      })

      bb.on('file', (fieldname: string, fileStream: NodeJS.ReadableStream, info: any) => {
        console.log(`[Upload] File received: ${info.filename} (field: ${fieldname})`)
        const chunks: Buffer[] = []
        fileStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        fileStream.on('end', () => {
          file = {
            filename: info.filename,
            data: Buffer.concat(chunks),
          }
          console.log(`[Upload] File buffered: ${info.filename} (${Buffer.concat(chunks).length} bytes)`)
        })
        fileStream.on('error', (err) => {
          console.error(`[Upload] File stream error:`, err)
          reject(err)
        })
      })

      bb.on('close', () => {
        console.log(`[Upload] Busboy closed. Category: ${category}, Type: ${type}, File: ${file?.filename}`)
        resolve()
      })

      bb.on('error', (err: Error) => {
        console.error(`[Upload] Busboy error:`, err)
        reject(err)
      })

      req.pipe(bb)
    })

    if (!file || !category || !type) {
      console.error(`[Upload] Missing fields: file=${!!file}, category=${category}, type=${type}`)
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const uploadedFile = file as { filename: string; data: Buffer }

    // Validate category and type
    if (!CATEGORY_TYPE_MAP[category] || !CATEGORY_TYPE_MAP[category][type]) {
      console.error(`[Upload] Invalid category or type: ${category}/${type}`)
      return res.status(400).json({ error: 'Invalid category or type' })
    }

    // Determine subfolder
    const subfolder = CATEGORY_TYPE_MAP[category][type]
    const knowledgeDir = path.join(process.cwd(), 'Atlas', 'knowledge', category, subfolder)

    console.log(`[Upload] Knowledge directory: ${knowledgeDir}`)

    // Create directory if it doesn't exist
    if (!fs.existsSync(knowledgeDir)) {
      console.log(`[Upload] Creating directory: ${knowledgeDir}`)
      fs.mkdirSync(knowledgeDir, { recursive: true })
    }

    // Save file
    const filePath = path.join(knowledgeDir, uploadedFile.filename)

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      console.error(`[Upload] File already exists: ${filePath}`)
      return res.status(409).json({ error: 'File already exists' })
    }

    console.log(`[Upload] Writing file: ${filePath}`)
    fs.writeFileSync(filePath, uploadedFile.data)

    // Add to database
    const relativeDbPath = path.relative(process.cwd(), filePath)
    console.log(`[Upload] Adding to database: ${relativeDbPath}`)
    const record = addFile({
      name: uploadedFile.filename,
      path: relativeDbPath,
      category,
      type,
      size: uploadedFile.data.length,
    })

    console.log(`[Upload] Success: ${record.id}`)
    return res.status(200).json({
      success: true,
      file: record,
    })
  } catch (error) {
    console.error('[Upload] Unexpected error:', error)
    return res.status(500).json({ error: 'Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error') })
  }
}
