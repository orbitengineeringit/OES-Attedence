import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !supabaseKey) {
  console.warn('\n[SUPABASE WARNING]: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file!');
  console.warn('The migration will fail without these credentials.\n');
}

// Service role client bypasses RLS, acting as the system authority.
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder', {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

// Simple health check to verify the connection is active
export const checkSupabaseConnection = async () => {
  if (!supabaseUrl || !supabaseKey) return false;
  try {
    const { data, error } = await supabase.from('settings').select('*').limit(1);
    if (error && error.code !== '42P01') { 
      // 42P01 means table does not exist, which is fine before migration
      throw error;
    }
    return true;
  } catch (err) {
    console.error('[SUPABASE CONNECTION ERROR]:', err.message);
    return false;
  }
};
