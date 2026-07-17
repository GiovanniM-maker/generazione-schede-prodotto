import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@app/database';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Client Supabase lato server (SSR) con publishable key. Rispetta la RLS
// nel contesto dell'utente autenticato.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: CookieToSet[]) => {
          try {
            for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
          } catch {
            // Chiamato da un Server Component: ignorabile, il refresh avviene nel middleware.
          }
        },
      },
    },
  );
}
