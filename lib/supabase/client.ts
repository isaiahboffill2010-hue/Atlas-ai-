import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase configuration in environment variables')
}

// Browser/client-side client (safe for frontend)
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey)

// Server-side admin client (with service role key)
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const supabaseAdmin =
  typeof window === 'undefined' && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null

export const getSupabaseClient = () => supabaseClient
export const getSupabaseAdmin = () => {
  if (typeof window !== 'undefined') {
    throw new Error('Cannot use admin client on the browser')
  }
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client not initialized')
  }
  return supabaseAdmin
}
