# Song Library Feature - Implementation Guide

This document describes the implementation of the comprehensive song library feature for Atlas.

## Overview

The song library feature allows users to:
1. **Save songs** - Songs are automatically saved when a user plays them (non-blocking)
2. **Play random songs** - Users can request a random song from their saved library
3. **Avoid duplicates** - Normalized titles prevent duplicate entries (e.g., "Numb", "NUMB", " Numb " are all treated as one song)

## Files Created

### Database
- **`lib/supabase/songs-db.ts`** - Database functions for song operations
  - `saveSong()` - Add or check if song exists
  - `getRandomSong()` - Fetch a random song
  - `getAllSongs()` - Fetch all songs
  - `getSongCount()` - Count total songs
  - `checkDuplicates()` - Verify no duplicate normalized titles

- **`scripts/create-atlas-songs-table.sql`** - SQL migration to create the table
  - Creates `atlas_songs` table with UUID id, song_title, normalized_title (UNIQUE), created_at
  - Creates indexes for faster lookups
  - Includes helper function for duplicate detection

### Music Library
- **`lib/music/normalize-song-title.ts`** - Utility function for consistent title normalization
  - Converts to lowercase
  - Trims whitespace
  - Collapses multiple spaces to single space
  - Examples: "Numb", "NUMB", " Numb " → "numb"

### API Endpoints
- **`pages/api/music/save-song.ts`** - POST endpoint to save a song
  - Request: `{ songTitle: string }`
  - Response: `{ success, saved, song }`
  - Handles unique constraint gracefully (already exists is NOT an error)

- **`pages/api/music/random-song.ts`** - GET endpoint to fetch a random song
  - Response: `{ success, result: { song_title, ... } }`
  - Returns 404 with error "Song library is empty" if no songs exist

### Music Command System
- **`lib/music/music-command-parser.ts`** (MODIFIED)
  - Added `'random'` to MusicCommand type
  - Added RANDOM_SONG_PATTERNS for pattern matching:
    - "play a song"
    - "play something"
    - "play something random"
    - "play a random song"
  - Random detection happens BEFORE play detection to prevent overlap

- **`lib/music/handle-music-command.ts`** (MODIFIED)
  - Added `'random'` case:
    1. Calls `/api/music/random-song`
    2. If empty: shows "No songs in your library yet. Save some songs first!"
    3. If found: searches YouTube and plays the song
  - Modified `'play'` case:
    1. After successful YouTube search
    2. Calls `/api/music/save-song` (fire-and-forget)
    3. Continues playing normally

### Seeding
- **`scripts/seed-songs.ts`** - TypeScript script to populate the database
  - Normalizes all song titles
  - Removes local duplicates
  - Inserts unique songs
  - Verifies no database duplicates
  - Reports final counts

## Setup Instructions

### Step 1: Create the Database Table

Run the SQL migration in your Supabase dashboard:

1. Go to https://app.supabase.com
2. Select your project (mfnrnasbfdjuxliwpkxd)
3. Open **SQL Editor**
4. Create a new query
5. Copy and paste the contents of `scripts/create-atlas-songs-table.sql`
6. Click **Run**

The migration will create:
- `atlas_songs` table
- Indexes for performance
- Helper function `find_duplicate_normalized_titles()`
- Row-level security policies

### Step 2: Verify Environment Variables

Ensure these are set in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` ✓ (already configured)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ✓ (already configured)
- `SUPABASE_SERVICE_ROLE_KEY` ✓ (already configured)
- `YOUTUBE_API_KEY` ✓ (already configured)

### Step 3: Seed the Database (Optional)

To populate your database with a pre-defined list of songs:

1. **Edit the song list** in `scripts/seed-songs.ts`:
   ```typescript
   const SONGS_LIST = [
     "Song Title 1 - Artist Name",
     "Song Title 2 - Artist Name",
     // ... add your 100+ songs here
   ]
   ```

2. **Run the seeding script**:
   ```bash
   npx ts-node scripts/seed-songs.ts
   ```

3. The script will:
   - Remove local duplicates
   - Insert unique songs into `atlas_songs`
   - Verify no database duplicates
   - Report final counts

### Step 4: Test the Feature

**Test saving songs:**
1. Run the app: `npm run dev`
2. Say: "Play numb by linkin park"
3. Song plays and is automatically saved to the library
4. Verify in Supabase: `SELECT * FROM atlas_songs`

**Test playing random songs:**
1. Say: "Play a song" or "Play something random"
2. Random song from your library is selected and played
3. Check logs to see which song was selected

**Test duplicate prevention:**
1. Say: "Play Numb by Linkin Park"
2. Say: "Play NUMB"
3. Say: "Play numb (explicit version)"
4. All three normalize to "numb"
5. Check Supabase: should have only 1 row with different song_title values or 1 row total (depending on exact titles)

## API Reference

### POST /api/music/save-song

Save a song to the library.

**Request:**
```json
{
  "songTitle": "Numb - Linkin Park"
}
```

**Response (Success):**
```json
{
  "success": true,
  "saved": true,
  "song": {
    "id": "uuid...",
    "song_title": "Numb - Linkin Park",
    "normalized_title": "numb - linkin park",
    "created_at": "2026-08-29T..."
  }
}
```

**Response (Already exists):**
```json
{
  "success": true,
  "saved": false,
  "song": { ... }
}
```

### GET /api/music/random-song

Get a random song from the library.

**Response (Success):**
```json
{
  "success": true,
  "result": {
    "id": "uuid...",
    "song_title": "Numb - Linkin Park",
    "normalized_title": "numb - linkin park",
    "created_at": "2026-08-29T..."
  }
}
```

**Response (Empty library):**
```json
{
  "success": false,
  "error": "Song library is empty"
}
```

## Architecture Notes

### Database Design
- **UUID primary key** - Unique identifier for each song record
- **song_title** - Original title as the user requested it (preserved for reference)
- **normalized_title** - Lowercase, trimmed, deduplicated version (UNIQUE constraint)
- **created_at** - Timestamp for sorting and auditing

### Duplicate Detection Strategy
1. **Normalization**: Convert titles consistently (lowercase, trim, collapse spaces)
2. **UNIQUE constraint**: Database enforces no duplicate normalized titles
3. **Graceful handling**: If duplicate exists, return the existing record with `saved: false`
4. **Transparent**: Users don't see errors - songs just aren't duplicated

### Fire-and-Forget Saving
- When a user plays a song with a specific query, it's saved non-blocking
- API call is made but not awaited
- If save fails, it doesn't interrupt playback
- Logged errors appear in browser console for debugging

### Random Selection
- PostgreSQL `RANDOM()` function for unbiased selection
- Works with any table size
- Indexes ensure performance even with large libraries

## Troubleshooting

### "Song library is empty" error
- No songs have been saved yet
- Seed the database using `scripts/seed-songs.ts`
- Or play some songs to build the library

### Duplicate songs appear in database
- Check that `normalized_title` UNIQUE constraint exists
- Verify the migration was run successfully
- Query: `SELECT * FROM atlas_songs WHERE normalized_title IN (SELECT normalized_title FROM atlas_songs GROUP BY normalized_title HAVING COUNT(*) > 1)`

### TypeError in songs-db.ts
- Ensure Supabase environment variables are set
- Check that `SUPABASE_SERVICE_ROLE_KEY` is defined (needed for backend operations)
- Verify table and functions exist in Supabase

### Random song endpoint returns error
- Verify the `atlas_songs` table exists: `SELECT * FROM information_schema.tables WHERE table_name = 'atlas_songs'`
- Check row count: `SELECT COUNT(*) FROM atlas_songs`
- Verify table has correct schema

## Testing Checklist

- [ ] TypeScript compiles without errors: `npx tsc --noEmit`
- [ ] Table created in Supabase
- [ ] Can save songs via `/api/music/save-song`
- [ ] Can get random song via `/api/music/random-song`
- [ ] "play a song" command triggers random behavior
- [ ] "play song name" command still works and saves the song
- [ ] Duplicate songs are not created
- [ ] Empty library returns appropriate error
- [ ] Music player displays current song correctly
- [ ] All existing music commands still work (play, pause, resume, stop, replay)

## Performance Considerations

### For Large Libraries (1000+ songs)
- Use PostgreSQL's `random()` function for O(1) selection
- Consider pagination if fetching all songs
- Monitor query performance with Supabase dashboard

### Indexes
The migration creates:
- `idx_atlas_songs_normalized_title` - For UNIQUE constraint and lookups
- `idx_atlas_songs_created_at` - For sorting by date

## Future Enhancements

1. **Playlists** - Group songs into named playlists
2. **Favorites** - Mark frequently played songs
3. **History** - Track when each song was last played
4. **Search** - Full-text search over song library
5. **Stats** - Most played songs, listening patterns
6. **Export** - Download library as JSON/CSV

## Files Summary

| File | Type | Purpose |
|------|------|---------|
| `lib/supabase/songs-db.ts` | Database | Song CRUD operations |
| `lib/music/normalize-song-title.ts` | Utility | Title normalization |
| `pages/api/music/save-song.ts` | API | Save song endpoint |
| `pages/api/music/random-song.ts` | API | Random song endpoint |
| `lib/music/music-command-parser.ts` | Logic | Parse music commands (MODIFIED) |
| `lib/music/handle-music-command.ts` | Logic | Execute music commands (MODIFIED) |
| `scripts/create-atlas-songs-table.sql` | Migration | Create database table |
| `scripts/seed-songs.ts` | Script | Populate database |

## Support

For issues or questions:
1. Check TypeScript compilation: `npx tsc --noEmit`
2. Check Supabase dashboard for table/data status
3. Review browser console for API errors
4. Check server logs for backend errors
