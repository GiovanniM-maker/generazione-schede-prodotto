'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface SignInState {
  error?: string;
  sent?: boolean;
  email?: string;
}

// Login senza password: invia un CODICE a 6 cifre via email (Supabase email OTP).
// Il template email deve usare {{ .Token }} per mostrare il codice. L'email
// contiene comunque anche il magic link come fallback (gestito da /auth/callback).
export async function signInWithEmail(
  _prev: SignInState | undefined,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
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
      // emailRedirectTo serve solo al magic link di fallback; il codice OTP
      // arriva comunque nella stessa email.
      options: { emailRedirectTo: `${appUrl}/auth/callback` },
    });
    if (error) return { error: error.message, email };
    return { sent: true, email };
  } catch (err) {
    return {
      error: `Impossibile inviare il codice di accesso: ${
        err instanceof Error ? err.message : 'errore sconosciuto'
      }`,
    };
  }
}

// Verifica il codice a 6 cifre e crea la sessione. Al successo redirige a /app.
export async function verifyOtpCode(
  _prev: SignInState | undefined,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const token = String(formData.get('token') ?? '').replace(/\D/g, '');
  if (!email) return { error: 'Sessione scaduta: richiedi un nuovo codice.' };
  if (token.length !== 6) return { error: 'Inserisci il codice a 6 cifre ricevuto via email.', sent: true, email };

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      return { error: 'Codice non valido o scaduto. Controlla o richiedine uno nuovo.', sent: true, email };
    }
  } catch (err) {
    return {
      error: `Verifica non riuscita: ${err instanceof Error ? err.message : 'errore sconosciuto'}`,
      sent: true,
      email,
    };
  }
  // Fuori dal try/catch: redirect() lancia un'eccezione di controllo che NON
  // va intercettata dal catch.
  redirect('/app');
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
