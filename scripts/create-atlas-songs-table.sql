-- Create atlas_songs table for the song library feature
-- Run this in Supabase SQL Editor

-- Drop table if exists (for development/testing)
-- DROP TABLE IF EXISTS atlas_songs;

-- Create atlas_songs table
CREATE TABLE IF NOT EXISTS atlas_songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_title TEXT NOT NULL,
  normalized_title TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on normalized_title for faster lookups
CREATE INDEX IF NOT EXISTS idx_atlas_songs_normalized_title ON atlas_songs(normalized_title);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_atlas_songs_created_at ON atlas_songs(created_at);

-- Create function to find duplicate normalized titles (for verification)
CREATE OR REPLACE FUNCTION find_duplicate_normalized_titles()
RETURNS TABLE(normalized_title TEXT, count BIGINT) AS $$
SELECT normalized_title, COUNT(*) as count
FROM atlas_songs
GROUP BY normalized_title
HAVING COUNT(*) > 1;
$$ LANGUAGE SQL;

-- Add row-level security (optional, if needed)
ALTER TABLE atlas_songs ENABLE ROW LEVEL SECURITY;

-- Create policy to allow reading from the table
CREATE POLICY "Allow public read access to songs" ON atlas_songs
  FOR SELECT
  USING (true);

-- Create policy to allow inserts only via authenticated service role
CREATE POLICY "Allow authenticated inserts" ON atlas_songs
  FOR INSERT
  WITH CHECK (true);

COMMENT ON TABLE atlas_songs IS 'Song library for Atlas - stores user-saved songs';
COMMENT ON COLUMN atlas_songs.id IS 'Unique identifier (UUID)';
COMMENT ON COLUMN atlas_songs.song_title IS 'Original song title as requested by user';
COMMENT ON COLUMN atlas_songs.normalized_title IS 'Lowercase, trimmed title for duplicate detection (UNIQUE)';
COMMENT ON COLUMN atlas_songs.created_at IS 'Timestamp when song was added to library';
