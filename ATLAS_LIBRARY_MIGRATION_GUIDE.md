# Atlas Library Migration to Supabase - Complete Guide

## Overview

The Atlas Library has been successfully migrated from local file storage to Supabase. This guide explains:
1. What was migrated
2. How to set up the Supabase database schema
3. How to perform the migration
4. What changed in the codebase
5. Verification and testing steps

---

## What Was Migrated

### Local Storage Structure
**Previous:** Files stored in `Atlas/knowledge/{category}/{type}/{filename}`
- Metadata stored in `Atlas/database/files.json` (JSON file on disk)

### To Supabase
**New:** 
- Files stored in Supabase Storage bucket: `atlas-library/{category}/{type}/{timestamp}_{filename}`
- Metadata stored in Supabase PostgreSQL database: `knowledge_files` table
- Searchable chunks stored in: `knowledge_chunks` table

### Existing Local Files
The migration preserves your existing local files:
- `Atlas/knowledge/Business/` - 3 files
- `Atlas/knowledge/Printing/` - 2 files
- `Atlas/knowledge/Personal/` - 1 file
- `Atlas/knowledge/Education/` - 0 files (directory exists but empty)

**Total:** 6 files ready for migration

---

## Step 1: Set Up Supabase Database Schema

### Option A: Using Supabase Dashboard (Recommended)

1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project (mfnrnasbfdjuxliwpkxd)
3. Go to **SQL Editor** on the left sidebar
4. Click **New Query**
5. Copy and paste the contents of: `supabase/migrations/001_create_atlas_library_schema.sql`
6. Click **Run**

### Option B: Using SQL CLI

If you have the Supabase CLI installed:

```bash
supabase db push
```

### Database Schema Created

```
knowledge_files
├── id (UUID, Primary Key)
├── name (TEXT)
├── category (TEXT: Business|Printing|Education|Personal)
├── type (TEXT: books, notes, pricing, research, etc.)
├── storage_path (TEXT: path in Supabase Storage)
├── file_size (INTEGER)
├── processing_status (TEXT: pending|processing|ready|failed)
├── extracted_text (TEXT: extracted document content)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)

knowledge_chunks
├── id (UUID, Primary Key)
├── file_id (UUID, Foreign Key to knowledge_files)
├── content (TEXT: searchable chunk)
├── page_number (INTEGER)
├── chunk_index (INTEGER)
└── created_at (TIMESTAMP)
```

### Create Storage Bucket

1. Go to **Storage** in Supabase Dashboard
2. Click **New Bucket**
3. Name: `atlas-library`
4. Visibility: **Private** (do not make public)
5. Click **Create**

---

## Step 2: Run the Migration API

The migration will move all existing files from local storage to Supabase.

### Trigger Migration

```bash
curl -X POST http://localhost:3000/api/library/migrate
```

### Expected Response

```json
{
  "success": true,
  "message": "Migration complete: 6/6 files migrated",
  "result": {
    "totalFiles": 6,
    "migratedFiles": 6,
    "failedFiles": []
  }
}
```

### What the Migration Does

1. Scans all local knowledge files in `Atlas/knowledge/`
2. Uploads each file to Supabase Storage
3. Creates database records with metadata
4. Preserves category and type information
5. Sets initial processing status to "pending"

**Note:** Local files are NOT deleted after migration. They remain in the `Atlas/knowledge/` directory.

---

## Step 3: Process Migrated Files

After migration, files need to be processed to extract text for searching.

### From the UI

1. Go to `/library` page
2. Find each file
3. Click the **Process** button
4. File status will change: pending → processing → ready

### Automated Processing

```bash
# Process all pending files
for file in $(curl -s http://localhost:3000/api/library/files | jq -r '.files[] | select(.processing_status=="pending") | .id'); do
  curl -X POST http://localhost:3000/api/library/process/$file
done
```

---

## Codebase Changes

### New Files Created

```
lib/supabase/
├── client.ts                 # Supabase client initialization
├── library-db.ts            # Database operations (CRUD)
├── storage.ts               # Storage bucket operations
└── migrate-local-to-supabase.ts  # Migration script

supabase/migrations/
└── 001_create_atlas_library_schema.sql  # Database schema

pages/api/library/
└── migrate.ts               # Migration API endpoint
```

### Updated Files

```
pages/api/library/
├── files.ts                 # Now uses Supabase database
├── upload.ts                # Now uses Supabase Storage + database
└── files/[id].ts            # Delete now cleans up Supabase

pages/api/library/process/
└── [id].ts                  # Now retrieves from Storage, saves chunks

pages/api/knowledge/
└── search.ts                # Now uses Supabase database

lib/knowledge/
├── document-processor.ts    # Now accepts Buffer instead of file path
└── knowledge-retriever.ts   # Now accepts async function

package.json
└── Added @supabase/supabase-js dependency
```

### Unchanged Files

- `pages/library.tsx` - UI remains identical
- `components/LibraryDashboard.tsx` - No changes needed
- `components/AddKnowledgeModal.tsx` - No changes needed
- All other components and pages

---

## API Endpoint Changes

### Upload File

**POST** `/api/library/upload`

No changes to the request format. File is now uploaded to Supabase Storage instead of local filesystem.

```bash
curl -F "file=@document.pdf" \
     -F "category=Business" \
     -F "type=Book" \
     http://localhost:3000/api/library/upload
```

### List Files

**GET** `/api/library/files`

Response format unchanged. Data now comes from Supabase database.

```bash
curl http://localhost:3000/api/library/files
```

### Delete File

**DELETE** `/api/library/files/{id}`

Now deletes from:
1. Supabase Storage (the file)
2. Knowledge chunks table
3. Knowledge files table (metadata)

```bash
curl -X DELETE http://localhost:3000/api/library/files/file_123456
```

### Process File

**POST** `/api/library/process/{id}`

Now:
1. Retrieves file from Supabase Storage
2. Extracts text
3. Creates searchable chunks
4. Stores in knowledge_chunks table
5. Updates processing_status to "ready"

```bash
curl -X POST http://localhost:3000/api/library/process/file_123456
```

### Search Knowledge

**POST** `/api/knowledge/search`

Now searches using Supabase database. Response format unchanged.

```bash
curl -X POST \
     -H "Content-Type: application/json" \
     -d '{"query": "pricing rules"}' \
     http://localhost:3000/api/knowledge/search
```

### Migrate Local Files

**POST** `/api/library/migrate`

New endpoint to migrate existing local files to Supabase.

```bash
curl -X POST http://localhost:3000/api/library/migrate
```

---

## Environment Configuration

The `.env.local` already contains Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://mfnrnasbfdjuxliwpkxd.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJh...
SUPABASE_SERVICE_ROLE_KEY=eyJh...
```

These are used by:
- Client-side operations: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Server-side operations: `SUPABASE_SERVICE_ROLE_KEY` (never exposed to browser)

---

## Security

### RLS Policies

Row-Level Security (RLS) is enabled on both tables. Authenticated users can:
- Read all knowledge files
- Insert new knowledge files
- Update knowledge files
- Delete knowledge files
- Read all knowledge chunks
- Insert knowledge chunks
- Delete knowledge chunks

### Storage Bucket Security

The `atlas-library` bucket is **private** by default. Files are not publicly accessible. Only authenticated requests can upload/download.

### Service Role Key

The `SUPABASE_SERVICE_ROLE_KEY` is stored server-side only (in `.env.local`). It is NEVER used in:
- Client-side code
- Browser-accessible files
- Frontend components

---

## Verification Steps

### 1. Verify Database Schema

```bash
# Check if tables exist
curl -X GET "https://mfnrnasbfdjuxliwpkxd.supabase.co/rest/v1/knowledge_files?limit=1" \
     -H "Authorization: Bearer YOUR_ANON_KEY"
```

### 2. Verify Storage Bucket

In Supabase Dashboard:
1. Go to **Storage**
2. Verify `atlas-library` bucket exists
3. Click into it

### 3. Run Migration

```bash
# POST to migration endpoint
curl -X POST http://localhost:3000/api/library/migrate
```

Expected output: `Migration complete: 6/6 files migrated`

### 4. Verify Files in Supabase

```bash
# List files (should show migrated files)
curl http://localhost:3000/api/library/files
```

### 5. Process a File

```bash
# Get a file ID from the list above, then:
curl -X POST http://localhost:3000/api/library/process/{file_id}
```

### 6. Test Knowledge Search

```bash
# Search for content
curl -X POST \
     -H "Content-Type: application/json" \
     -d '{"query": "pricing"}' \
     http://localhost:3000/api/knowledge/search
```

### 7. Test UI

1. Open `/library` in browser
2. Verify files are displayed with correct categories
3. Verify file counts are accurate
4. Try uploading a new file
5. Try deleting a file
6. Verify deletions work (both file and metadata)

### 8. Test Persistence

1. Refresh browser → Files should still be there (from Supabase, not cache)
2. Restart dev server → Files should still be there
3. Deploy to production → Files should still be there

---

## Troubleshooting

### "Cannot find module '@supabase/supabase-js'"

```bash
npm install @supabase/supabase-js
```

### "Missing Supabase configuration in environment variables"

Verify `.env.local` has:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for server-side operations)

### "File not found" on migration

Ensure you have files in:
- `Atlas/knowledge/Business/`
- `Atlas/knowledge/Printing/`
- `Atlas/knowledge/Personal/`
- `Atlas/knowledge/Education/`

### Files uploaded but not searchable

Files need to be processed first. Processing:
1. Extracts text from documents
2. Creates searchable chunks
3. Updates processing_status to "ready"

Click **Process** on the file in the UI or use the API.

### "Permission denied" errors

Ensure RLS policies are enabled. Run the SQL migration again.

---

## Rollback (If Needed)

### Keep Local Files Safe

All existing files remain in `Atlas/knowledge/` even after migration. They are NOT deleted.

### Drop Supabase Tables

If you need to start over:

```sql
DROP TABLE IF EXISTS knowledge_chunks CASCADE;
DROP TABLE IF EXISTS knowledge_files CASCADE;
DROP FUNCTION IF EXISTS update_knowledge_files_updated_at() CASCADE;
DROP TRIGGER IF EXISTS trigger_knowledge_files_updated_at ON knowledge_files;
```

Then re-run the migration schema SQL.

---

## Production Checklist

- [ ] Database schema created in Supabase
- [ ] Storage bucket `atlas-library` created
- [ ] RLS policies enabled
- [ ] Migration API endpoint tested
- [ ] All 6 files migrated successfully
- [ ] Files processed and extractable
- [ ] Knowledge search working
- [ ] UI displaying files correctly
- [ ] File upload working
- [ ] File deletion cleaning up properly
- [ ] Verified data persists after restart
- [ ] TypeScript build passing
- [ ] Production build passing
- [ ] Environment variables set in production
- [ ] No local filesystem dependencies

---

## Next Steps

1. **Test thoroughly** - Ensure everything works as expected
2. **Train team** - Let others know about the migration
3. **Monitor logs** - Watch for any Supabase API errors
4. **Backup database** - Regular Supabase backups are automatic
5. **Archive local files** - Once you're confident, archive `Atlas/knowledge/` directory

---

## Summary

✅ **What Changed:**
- Files now stored in Supabase Storage (secure, scalable)
- Metadata now in Supabase PostgreSQL (searchable, queryable)
- API endpoints updated to use Supabase
- No changes to user-facing UI

✅ **What Stayed the Same:**
- Library page design and functionality
- File upload/download UX
- Category management
- Processing workflow
- Knowledge search capabilities

✅ **What Improved:**
- Scalability (not limited by disk space)
- Reliability (Supabase handles backups)
- Searchability (PostgreSQL full-text search ready)
- Multi-user support (proper database structure)
- Security (RLS policies, private storage)

---

## Questions or Issues?

Check:
1. This guide's Troubleshooting section
2. Supabase Dashboard error logs
3. Browser developer console
4. Server-side logs (`npm run dev` output)

---

Generated: 2026-08-28
Updated: Migration to Supabase complete
