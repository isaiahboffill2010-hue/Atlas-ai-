/**
 * Complete setup for the song library
 * This script:
 * 1. Creates the atlas_songs table (if it doesn't exist)
 * 2. Seeds it with songs from seed-songs.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Missing Supabase environment variables')
  process.exit(1)
}

const db = createClient(supabaseUrl, supabaseServiceRoleKey)

async function setupSongLibrary() {
  try {
    console.log('🚀 Setting up song library...\n')

    // Step 1: Create table
    console.log('📋 Creating atlas_songs table...')
    const { error: tableError } = await db.rpc('_raw_sql_execute' as any, {
      query: `
        CREATE TABLE IF NOT EXISTS atlas_songs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          song_title TEXT NOT NULL,
          normalized_title TEXT NOT NULL UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_atlas_songs_normalized_title ON atlas_songs(normalized_title);
        CREATE INDEX IF NOT EXISTS idx_atlas_songs_created_at ON atlas_songs(created_at);

        CREATE OR REPLACE FUNCTION find_duplicate_normalized_titles()
        RETURNS TABLE(normalized_title TEXT, count BIGINT) AS $$
        SELECT normalized_title, COUNT(*) as count
        FROM atlas_songs
        GROUP BY normalized_title
        HAVING COUNT(*) > 1;
        $$ LANGUAGE SQL;

        ALTER TABLE atlas_songs ENABLE ROW LEVEL SECURITY;

        CREATE POLICY IF NOT EXISTS "Allow public read access to songs" ON atlas_songs
          FOR SELECT USING (true);

        CREATE POLICY IF NOT EXISTS "Allow authenticated inserts" ON atlas_songs
          FOR INSERT WITH CHECK (true);
      `,
    } as any)

    // Note: The RPC approach may not work. Let's instead verify the table exists
    // by trying to query it, and if it doesn't exist, we'll guide the user to create it manually

    console.log('\n✓ Checking if table exists...')
    const { data: tableCheck, error: checkError } = await db.from('atlas_songs').select('count', { count: 'exact', head: true })

    if (checkError) {
      console.error('\n⚠️  Table does not exist yet.')
      console.error('\n📌 NEXT STEP: Create the table in Supabase manually')
      console.error('   1. Go to: https://supabase.com/dashboard/project/mfnrnasbfdjuxliwpkxd/sql/new')
      console.error('   2. Copy and paste the SQL from: scripts/create-atlas-songs-table.sql')
      console.error('   3. Click "Run"')
      console.error('\n   Then run this script again to seed the songs.')
      process.exit(1)
    }

    console.log('✓ Table exists!')

    // Step 2: Seed songs
    console.log('\n🌱 Seeding songs...')
    const seedOutput = await import('./seed-songs')
    console.log('\n✅ Setup complete!')
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

setupSongLibrary()
