import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './generated/database.types.js';

// ---------------------------------------------------------------------------
// Client con service role. SOLO server/worker. Bypassa RLS. Mai nel browser.
// ---------------------------------------------------------------------------

export type TypedClient = SupabaseClient<Database>;

export function createServiceClient(url: string, serviceRoleKey: string): TypedClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
