'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@app/database';

// Client Supabase lato browser: SOLO publishable key.
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
