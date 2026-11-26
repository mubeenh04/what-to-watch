// Public Supabase settings. The URL and the publishable (anon) key are safe to ship in an app:
// row-level security in the database decides what each signed-in user can read and change.
// Never put the service role key or any other secret here.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';

export const isConfigured = /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_KEY.length > 20;

export const PAGE_SIZE = 20;
