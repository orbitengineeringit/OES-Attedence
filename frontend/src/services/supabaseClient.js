import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co').trim();
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder').replace('anon public ', '').trim();

if (supabaseUrl.includes('placeholder.supabase.co')) {
  console.error('[Supabase Configuration Error]: VITE_SUPABASE_URL is missing. If you just created the .env file, you must RESTART the Vite dev server.');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Persist session in localStorage so refresh hydrates instantly
    persistSession: true,
    // Auto-refresh the token before it expires
    autoRefreshToken: true,
    // Don't detect session from URL (we use localStorage only)
    detectSessionInUrl: false,
    // Store keys with stable prefix
    storageKey: 'quantum-guard-auth',
  }
});
