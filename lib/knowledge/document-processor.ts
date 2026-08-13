import fs from 'fs'
import path from 'path'
import pdfParse from 'pdf-parse'
import { FileRecord } from '../db'

export interface ExtractedDocument {
  fileId: string
  fileName: string
  category: string
  type: string
  pages: number
  text: string
  extractedAt: number
}

export async function extractPdfText(filePath: string): Promise<string> {
  try {
    console.log(`[DocumentProcessor] Extracting PDF: ${filePath}`)

    // Read the PDF file
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const fileBuffer = fs.readFileSync(filePath)
    console.log(`[DocumentProcessor] PDF file size: ${fileBuffer.length} bytes`)

    // Parse the PDF
    const data = await pdfParse(fileBuffer)
    console.log(`[DocumentProcessor] PDF has ${data.numpages} pages`)

    // Extract text from all pages
    const textPages: string[] = []
    if (data.text) {
      // pdfParse returns text as a single string, but we can try to preserve page structure
      const lines = data.text.split('\n')
      textPages.push(data.text)
    } else {
      throw new Error('No extractable text found in PDF')
    }

    const fullText = textPages.join('\n---\n')
    console.log(`[DocumentProcessor] Extracted ${fullText.length} characters`)

    return fullText
  } catch (error) {
    console.error('[DocumentProcessor] PDF extraction error:', error)
    throw error
  }
}

export async function processDocument(file: FileRecord): Promise<ExtractedDocument> {
  try {
    console.log(`[DocumentProcessor] Processing document: ${file.name}`)

    // Construct the full file path
    const fullPath = path.join(process.cwd(), file.path)

    // Determine how to process based on file type
    let text = ''

    if (file.name.toLowerCase().endsWith('.pdf')) {
      text = await extractPdfText(fullPath)
    } else if (file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.md')) {
      // For text files, just read the content
      text = fs.readFileSync(fullPath, 'utf-8')
      console.log(`[DocumentProcessor] Read text file: ${text.length} characters`)
    } else {
      throw new Error(`Unsupported file type: ${file.name}`)
    }

    const result: ExtractedDocument = {
      fileId: file.id,
      fileName: file.name,
      category: file.category,
      type: file.type,
      pages: 1, // Will be updated for PDFs
      text,
      extractedAt: Date.now(),
    }

    // If it's a PDF, try to estimate page count
    if (file.name.toLowerCase().endsWith('.pdf')) {
      // This is a rough estimate based on text length
      const estimatedPages = Math.max(1, Math.ceil(text.length / 3000))
      result.pages = estimatedPages
    }

    console.log(`[DocumentProcessor] Document processed successfully`)
    return result
  } catch (error) {
    console.error('[DocumentProcessor] Error processing document:', error)
    throw error
  }
}

export async function extractDocumentPreview(document: ExtractedDocument, maxChars: number = 500): Promise<string> {
  return document.text.substring(0, maxChars) + (document.text.length > maxChars ? '...' : '')
}
