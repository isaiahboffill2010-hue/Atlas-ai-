import type { NextApiRequest, NextApiResponse } from 'next'
import Busboy from 'busboy'
import { addKnowledgeFile } from '../../../lib/supabase/library-db'
import { uploadFileToStorage } from '../../../lib/supabase/storage'

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

    try {
      // Upload to Supabase Storage
      console.log(`[Upload] Uploading to Supabase Storage...`)
      const storagePath = await uploadFileToStorage(
        category,
        CATEGORY_TYPE_MAP[category][type],
        uploadedFile.filename,
        uploadedFile.data
      )

      // Add to Supabase database
      console.log(`[Upload] Adding to Supabase database...`)
      const record = await addKnowledgeFile({
        name: uploadedFile.filename,
        category: category as 'Business' | 'Printing' | 'Education' | 'Personal',
        type: CATEGORY_TYPE_MAP[category][type],
        storage_path: storagePath,
        file_size: uploadedFile.data.length,
        processing_status: 'pending',
      })

      console.log(`[Upload] Success: ${record.id}`)
      return res.status(200).json({
        success: true,
        file: record,
      })
    } catch (uploadError) {
      console.error(`[Upload] Supabase upload error:`, uploadError)
      throw uploadError
    }
  } catch (error) {
    console.error('[Upload] Unexpected error:', error)
    return res.status(500).json({ error: 'Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error') })
  }
}
