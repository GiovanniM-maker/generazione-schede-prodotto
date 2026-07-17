'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Login via magic link (OTP email). Nessuna password custom.
export async function signInWithEmail(
  _prev: { error?: string; sent?: boolean } | undefined,
  formData: FormData,
): Promise<{ error?: string; sent?: boolean }> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email || !email.includes('@')) return { error: 'Inserisci un indirizzo email valido' };

  // Config mancante: messaggio chiaro invece di un crash generico.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return {
      error:
        'Configurazione Supabase mancante. Imposta NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY nelle variabili d’ambiente e riprova.',
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${appUrl}/auth/callback` },
    });
    if (error) return { error: error.message };
    return { sent: true };
  } catch (err) {
    return {
      error: `Impossibile inviare il link di accesso: ${
        err instanceof Error ? err.message : 'errore sconosciuto'
      }`,
    };
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
