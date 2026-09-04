/**
 * Seed the atlas_songs table with a list of songs
 *
 * Usage:
 * npx ts-node scripts/seed-songs.ts
 *
 * This script will:
 * 1. Read the songs from SONGS_LIST array below
 * 2. Normalize each title
 * 3. Remove duplicates
 * 4. Insert into atlas_songs table
 * 5. Report final counts and verify no duplicates in DB
 */

import { createClient } from '@supabase/supabase-js'
import { normalizeSongTitle } from '../lib/music/normalize-song-title.js'

// Songs to seed - user's complete song library
const SONGS_LIST = [
  "Hold On - Justin Bieber",
  "Off My Face - Justin Bieber",
  "NIGHTS LIKE THIS - The Kid LAROI",
  "Walking On A Dream - Empire Of The Sun",
  "Somewhere Only We Know - Keane",
  "The Middle - Jimmy Eat World",
  "Numb - Linkin Park",
  "Rock with You - Single Version - Michael Jackson",
  "All I Wanted - Paramore",
  "Jane! - The Long Faces",
  "Sure Thing - Miguel",
  "Duvet - boa",
  "Island In The Sun - Weezer",
  "Make Me Better - Fabolous, Ne-Yo",
  "Prom Queen - Beach Bunny",
  "I Wonder - Kanye West",
  "Bound 2 - Kanye West",
  "Heart To Heart - Mac DeMarco",
  "Everybody Wants To Rule The World - Tears For Fears",
  "505 - Arctic Monkeys",
  "Tek It - Cafuné",
  "Tek It - Sped Up - Cafuné",
  "Into You (feat. Tamia) - Early Fade Main Mix Amended - Fabolous, Tamia",
  "Dumpweed - blink-182",
  "The Reason - Hoobastank",
  "The Rock Show - blink-182",
  "This Love - Maroon 5",
  "Can't Let You Go (feat. Mike Shorey & Lil' Mo) - Fabolous, Lil' Mo, Mike Shorey",
  "Hypnotize - 2014 Remaster - The Notorious B.I.G.",
  "Killing Me Softly With His Song - Fugees, Ms. Lauryn Hill",
  "Get Lucky (feat. Pharrell Williams and Nile Rodgers) - Daft Punk, Pharrell Williams, Nile Rodgers",
  "Adam's Song - blink-182",
  "welcome and goodbye - Dream, Ivory",
  "Heartless - Kanye West",
  "Where'd All the Time Go? - Dr. Dog",
  "Where Is My Mind? - 2007 Remaster - Pixies",
  "Lovefool - The Cardigans",
  "Blue Hair - TV Girl",
  "Flashing Lights - Kanye West, Dwele",
  "Not Allowed - TV Girl",
  "Nope your too late i already died - wifiskeleton, i wanna be a jack-o-lantern",
  "Infrunami - Steve Lacy",
  "Notion - The Rare Occasions",
  "I Love You So - The Walters",
  "Freaks - Surf Curse",
  "Still Not a Player (feat. Joe) - Radio Version - Big Pun, Joe",
  "Dark Red - Steve Lacy",
  "Lovers Rock - TV Girl",
  "No Scrubs - TLC",
  "When I See U - Fantasia",
  "Love Me Not - Ravyn Lenae",
  "All Falls Down - Kanye West, Syleena Johnson",
  "Riptide - Vance Joy",
  "Clocks - Coldplay",
  "Wonderwall - Remastered - Oasis",
  "Ms. Jackson - Outkast",
  "Sweet Boy - Malcolm Todd",
  "Earrings - Malcolm Todd",
  "Malcolm In The Middle - Malcolm Todd",
  "What's My Age Again? - blink-182",
  "Basket Case - Green Day",
  "I Thought I Saw Your Face Today",
  "Impostor Syndrome - Sidney Gish",
  "Brain Stew - Green Day",
  "Creep - Radiohead",
  "Mr. Brightside - The Killers",
  "Black Hole Sun - Soundgarden",
  "Everlong - Foo Fighters",
  "Come As You Are - Nirvana",
  "Lithium - Nirvana",
  "Heart-Shaped Box - Nirvana",
  "Sailor Song - Gigi Perez",
  "Sweater Weather - The Neighbourhood",
  "Stick Season - Noah Kahan",
  "Kiss Me - Sixpence None The Richer",
  "Yellow - Coldplay",
  "Cigarettes out the Window - TV Girl",
  "Looking Out for You - Joy Again",
  "Viva La Vida - Coldplay",
  "Iris - The Goo Goo Dolls",
  "Babydoll - Dominic Fike",
  "Californication - Red Hot Chili Peppers",
  "Shut up My Moms Calling - Hotel Ugly",
  "Into You (feat. Tamia) - Main Mix - Fabolous, Tamia",
  "Un-thinkable (I'm Ready) - Alicia Keys",
  "Drowning (feat. Kodak Black) - A Boogie Wit da Hoodie, Kodak Black",
  "Still Think About You - A Boogie Wit da Hoodie",
  "Right My Wrongs - Bryson Tiller",
  "Exchange - Bryson Tiller",
  "Planez - Jeremih, J. Cole",
  "Don't Tell 'Em - Jeremih, YG",
  "Don't - Bryson Tiller",
  "oui - Jeremih",
  "Teenage Dirtbag - Wheatus",
  "Smells Like Teen Spirit - Nirvana",
  "Teenage Fever - Drake",
  "Do Not Disturb - Drake",
  "9 - Drake",
]

async function seedSongs() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ Missing Supabase environment variables')
    console.error('   NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗')
    console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceRoleKey ? '✓' : '✗')
    process.exit(1)
  }

  const db = createClient(supabaseUrl, supabaseServiceRoleKey)

  try {
    console.log('🌱 Starting song library seeding...')
    console.log(`📊 Total songs in list: ${SONGS_LIST.length}`)

    // Step 1: Normalize and deduplicate locally
    console.log('\n📋 Processing songs...')
    const normalizedMap = new Map<string, string>() // normalized_title -> song_title
    let localDuplicates = 0

    for (const song of SONGS_LIST) {
      const trimmed = song.trim()
      const normalized = normalizeSongTitle(trimmed)

      if (normalizedMap.has(normalized)) {
        console.log(`  ⚠️  Duplicate found (local): "${trimmed}" (normalized: "${normalized}")`)
        console.log(`      Already have: "${normalizedMap.get(normalized)}"`)
        localDuplicates++
      } else {
        normalizedMap.set(normalized, trimmed)
      }
    }

    const uniqueSongs = Array.from(normalizedMap.entries()).map(([normalized, title]) => ({
      song_title: title,
      normalized_title: normalized,
    }))

    console.log(`✓ Unique songs after deduplication: ${uniqueSongs.length}`)
    if (localDuplicates > 0) {
      console.log(`⚠️  Local duplicates removed: ${localDuplicates}`)
    }

    // Step 2: Insert into database
    console.log('\n🔄 Inserting songs into database...')

    const { data, error } = await db.from('atlas_songs').insert(uniqueSongs).select()

    if (error) {
      console.error('❌ Database error:', error)
      process.exit(1)
    }

    console.log(`✓ Successfully inserted ${data?.length || 0} songs`)

    // Step 3: Verify final count
    console.log('\n📊 Verifying database state...')
    const { count, error: countError } = await db
      .from('atlas_songs')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      console.error('❌ Error getting count:', countError)
      process.exit(1)
    }

    console.log(`✓ Total songs in database: ${count}`)

    // Step 4: Check for duplicates in database
    console.log('\n🔍 Checking for database duplicates...')
    const { data: duplicates, error: dupError } = await db.rpc('find_duplicate_normalized_titles')

    if (dupError) {
      console.error('⚠️  Could not check for duplicates (function may not exist):', dupError.message)
      console.log('   To check duplicates, run this SQL in Supabase:')
      console.log('   SELECT normalized_title, COUNT(*) FROM atlas_songs GROUP BY normalized_title HAVING COUNT(*) > 1')
    } else if (duplicates && duplicates.length > 0) {
      console.error(`❌ Found ${duplicates.length} duplicate normalized titles:`)
      for (const dup of duplicates) {
        console.error(`   - "${dup.normalized_title}" (count: ${dup.count})`)
      }
      process.exit(1)
    } else {
      console.log('✓ No duplicates found in database')
    }

    // Step 5: Summary
    console.log('\n' + '='.repeat(50))
    console.log('✅ SEEDING COMPLETE')
    console.log('='.repeat(50))
    console.log(`Original songs in list:  ${SONGS_LIST.length}`)
    console.log(`Local duplicates found:  ${localDuplicates}`)
    console.log(`Unique songs inserted:   ${uniqueSongs.length}`)
    console.log(`Total songs in DB:       ${count}`)
    console.log('='.repeat(50))
  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

seedSongs()
