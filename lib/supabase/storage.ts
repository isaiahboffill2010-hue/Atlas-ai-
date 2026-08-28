import { getSupabaseAdmin, supabaseClient } from './client'

const STORAGE_BUCKET = 'atlas-library'

// Storage operations
export async function uploadFileToStorage(
  category: string,
  type: string,
  fileName: string,
  fileData: Buffer | Uint8Array
): Promise<string> {
  const client = getSupabaseAdmin()

  // Create path: category/type/filename
  const storagePath = `${category}/${type}/${Date.now()}_${fileName}`

  console.log(`[Storage] Uploading file to: ${storagePath}`)

  const { data, error } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileData, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) {
    console.error('[Storage] Error uploading file:', error)
    throw error
  }

  console.log(`[Storage] File uploaded successfully: ${storagePath}`)
  return storagePath
}

export async function deleteFileFromStorage(storagePath: string): Promise<void> {
  const client = getSupabaseAdmin()

  console.log(`[Storage] Deleting file: ${storagePath}`)

  const { error } = await client.storage.from(STORAGE_BUCKET).remove([storagePath])

  if (error) {
    console.error('[Storage] Error deleting file:', error)
    throw error
  }

  console.log(`[Storage] File deleted successfully: ${storagePath}`)
}

export async function getFileFromStorage(storagePath: string): Promise<Buffer> {
  const client = getSupabaseAdmin()

  console.log(`[Storage] Retrieving file: ${storagePath}`)

  const { data, error } = await client.storage.from(STORAGE_BUCKET).download(storagePath)

  if (error) {
    console.error('[Storage] Error retrieving file:', error)
    throw error
  }

  if (!data) {
    throw new Error('No data returned from storage')
  }

  // Convert blob to buffer
  const arrayBuffer = await (data as Blob).arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function getPublicFileUrl(storagePath: string): Promise<string> {
  const client = supabaseClient

  const { data } = client.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath)

  return data?.publicUrl || ''
}

export async function ensureStorageBucketExists(): Promise<void> {
  const client = getSupabaseAdmin()

  try {
    // Try to get bucket
    const { data, error: getError } = await client.storage.listBuckets()

    if (getError) {
      console.error('[Storage] Error listing buckets:', getError)
      throw getError
    }

    const bucketExists = data?.some((b: any) => b.name === STORAGE_BUCKET)

    if (!bucketExists) {
      console.log(`[Storage] Creating bucket: ${STORAGE_BUCKET}`)

      const { error: createError } = await client.storage.createBucket(STORAGE_BUCKET, {
        public: false,
        fileSizeLimit: 100 * 1024 * 1024, // 100MB
      })

      if (createError) {
        console.error('[Storage] Error creating bucket:', createError)
        throw createError
      }

      console.log(`[Storage] Bucket created: ${STORAGE_BUCKET}`)
    } else {
      console.log(`[Storage] Bucket already exists: ${STORAGE_BUCKET}`)
    }
  } catch (error) {
    console.error('[Storage] Error ensuring bucket exists:', error)
    // Don't throw - bucket might already exist
  }
}
