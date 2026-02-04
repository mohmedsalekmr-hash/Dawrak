import { createClient } from '@supabase/supabase-js'
import type { Database } from './types/supabase'

const supabaseUrl = 'https://httotcgsfngzewgpoetb.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0dG90Y2dzZm5nemV3Z3BvZXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk2MTIsImV4cCI6MjA4NTUwNTYxMn0.gNO4JTKrLz2NS_T51I56W8Xw1IqpDbs0Id0OdWaD_sE'

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
