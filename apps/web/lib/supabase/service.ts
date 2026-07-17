import { createServiceClient } from '@app/database';
import { getServerEnv } from '@/lib/env.server';

// Client service-role: SOLO in route handler/server action server-side.
// Bypassa RLS. Non esporre mai al browser.
export function getServiceClient() {
  const env = getServerEnv();
  return createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
