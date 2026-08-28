import fs from 'fs'
import path from 'path'
import { addKnowledgeFile, updateFileProcessingStatus } from './library-db'
import { uploadFileToStorage } from './storage'

export interface MigrationResult {
  totalFiles: number
  migratedFiles: number
  failedFiles: Array<{ file: string; error: string }>
}

const CATEGORY_TYPE_MAP: Record<string, Record<string, string>> = {
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
  Personal: {
    Note: 'notes',
    Project: 'projects',
    Decision: 'decisions',
  },
}

export async function migrateLocalFilesToSupabase(): Promise<MigrationResult> {
  console.log('[Migration] Starting local to Supabase migration...')

  const result: MigrationResult = {
    totalFiles: 0,
    migratedFiles: 0,
    failedFiles: [],
  }

  const knowledgeDir = path.join(process.cwd(), 'Atlas', 'knowledge')

  if (!fs.existsSync(knowledgeDir)) {
    console.log('[Migration] No local knowledge directory found')
    return result
  }

  // Iterate through categories
  for (const category of Object.keys(CATEGORY_TYPE_MAP)) {
    const categoryDir = path.join(knowledgeDir, category)

    if (!fs.existsSync(categoryDir)) {
      console.log(`[Migration] Category directory not found: ${category}`)
      continue
    }

    // Iterate through types
    for (const type of Object.keys(CATEGORY_TYPE_MAP[category])) {
      const typeDir = path.join(categoryDir, CATEGORY_TYPE_MAP[category][type])

      if (!fs.existsSync(typeDir)) {
        continue
      }

      // Get all files in this type directory
      const files = fs.readdirSync(typeDir).filter((f) => {
        const fullPath = path.join(typeDir, f)
        return fs.statSync(fullPath).isFile()
      })

      for (const fileName of files) {
        result.totalFiles++

        try {
          const filePath = path.join(typeDir, fileName)
          console.log(`[Migration] Processing: ${category}/${type}/${fileName}`)

          // Read file
          const fileData = fs.readFileSync(filePath)
          const fileSize = fileData.length

          // Upload to Supabase Storage
          console.log(`[Migration] Uploading to Storage...`)
          const storagePath = await uploadFileToStorage(category, type, fileName, fileData)

          // Create database record
          console.log(`[Migration] Creating database record...`)
          const record = await addKnowledgeFile({
            name: fileName,
            category: category as 'Business' | 'Printing' | 'Education' | 'Personal',
            type,
            storage_path: storagePath,
            file_size: fileSize,
            processing_status: 'pending',
          })

          console.log(`[Migration] Successfully migrated: ${fileName} (ID: ${record.id})`)
          result.migratedFiles++
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.error(`[Migration] Failed to migrate ${fileName}: ${errorMessage}`)
          result.failedFiles.push({
            file: `${category}/${type}/${fileName}`,
            error: errorMessage,
          })
        }
      }
    }
  }

  console.log('[Migration] Migration complete!')
  console.log(`[Migration] Migrated: ${result.migratedFiles}/${result.totalFiles} files`)

  if (result.failedFiles.length > 0) {
    console.log('[Migration] Failed files:')
    for (const failed of result.failedFiles) {
      console.log(`  - ${failed.file}: ${failed.error}`)
    }
  }

  return result
}
