import path from 'path'
import fs from 'fs'

const dbDir = path.join(process.cwd(), 'Atlas', 'database')
const dbPath = path.join(dbDir, 'files.json')

// Ensure directory exists
if (!fs.existsSync(dbDir)) {
  console.log(`[DB] Creating database directory: ${dbDir}`)
  fs.mkdirSync(dbDir, { recursive: true })
}
console.log(`[DB] Database path: ${dbPath}`)

export interface FileRecord {
  id: string
  name: string
  path: string
  category: string
  type: string
  size: number
  created_at: number
  updated_at: number
  processing_status?: 'pending' | 'processing' | 'ready' | 'failed'
  extracted_text?: string
  extracted_at?: number
  data_type?: 'fact' | 'memory' | 'life_event' | 'relationship' | 'personality_trait' | 'preference' | 'story' | 'communication_style'
}

interface FileDatabase {
  files: FileRecord[]
}

function loadDatabase(): FileDatabase {
  try {
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('Error loading database:', error)
  }
  return { files: [] }
}

function saveDatabase(db: FileDatabase): void {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8')
  } catch (error) {
    console.error('Error saving database:', error)
    throw error
  }
}

export function addFile(record: Omit<FileRecord, 'id' | 'created_at' | 'updated_at'>): FileRecord {
  const db = loadDatabase()
  const id = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const now = Date.now()

  const newRecord: FileRecord = {
    id,
    ...record,
    created_at: now,
    updated_at: now,
  }

  db.files.push(newRecord)
  console.log(`[DB] Adding file: ${record.name} (${record.category}/${record.type})`)
  saveDatabase(db)
  console.log(`[DB] File added with ID: ${id}`)

  return newRecord
}

export function getFiles(): FileRecord[] {
  const db = loadDatabase()
  const sorted = db.files.sort((a, b) => b.created_at - a.created_at)
  console.log(`[DB] getFiles: returning ${sorted.length} files`)
  return sorted
}

export function getFilesByCategory(category: string): FileRecord[] {
  const db = loadDatabase()
  return db.files
    .filter((f) => f.category === category)
    .sort((a, b) => b.created_at - a.created_at)
}

export function searchFiles(query: string): FileRecord[] {
  const db = loadDatabase()
  const queryLower = query.toLowerCase()
  return db.files
    .filter(
      (f) =>
        f.name.toLowerCase().includes(queryLower) ||
        f.category.toLowerCase().includes(queryLower) ||
        f.type.toLowerCase().includes(queryLower)
    )
    .sort((a, b) => b.created_at - a.created_at)
}

export function getFile(id: string): FileRecord | undefined {
  const db = loadDatabase()
  return db.files.find((f) => f.id === id)
}

export function deleteFile(id: string): boolean {
  const db = loadDatabase()
  const initialLength = db.files.length
  const fileToDelete = db.files.find((f) => f.id === id)
  db.files = db.files.filter((f) => f.id !== id)
  if (db.files.length < initialLength) {
    console.log(`[DB] Deleting file: ${fileToDelete?.name} (ID: ${id})`)
    saveDatabase(db)
    console.log(`[DB] File deleted successfully`)
    return true
  }
  console.log(`[DB] File not found for deletion: ${id}`)
  return false
}

export function getFileByPath(filePath: string): FileRecord | undefined {
  const db = loadDatabase()
  return db.files.find((f) => f.path === filePath)
}

export function getFileCounts(): Record<string, number> {
  const db = loadDatabase()
  const counts: Record<string, number> = {}
  for (const file of db.files) {
    counts[file.category] = (counts[file.category] || 0) + 1
  }
  return counts
}

export function updateFileProcessingStatus(
  id: string,
  status: 'pending' | 'processing' | 'ready' | 'failed',
  extractedText?: string
): boolean {
  const db = loadDatabase()
  const file = db.files.find((f) => f.id === id)

  if (!file) {
    console.log(`[DB] File not found for status update: ${id}`)
    return false
  }

  console.log(`[DB] Updating processing status: ${id} → ${status}`)
  file.processing_status = status
  file.updated_at = Date.now()

  if (extractedText) {
    file.extracted_text = extractedText
    file.extracted_at = Date.now()
  }

  saveDatabase(db)
  console.log(`[DB] Processing status updated: ${id}`)
  return true
}

export function getFileProcessingStatus(id: string): string {
  const file = getFile(id)
  if (!file) {
    return 'not_found'
  }
  return file.processing_status || 'pending'
}
