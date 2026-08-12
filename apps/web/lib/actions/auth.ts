'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { messaggioAccesso } from '@/lib/errori-accesso';

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

  // Config mancante: è un guasto nostro, e chi sta provando a entrare non può
  // farci niente. Il nome delle variabili d'ambiente serve a noi, non a lui.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    console.error(
      '[accesso] configurazione mancante: NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
    return {
      error: 'L’accesso non è disponibile in questo momento. Riprova fra qualche minuto.',
      email,
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
    // Era `error.message`: il testo del fornitore, in inglese, sull'unica
    // porta d'ingresso del prodotto.
    if (error) return { error: messaggioAccesso(error, 'invio codice'), email };
    return { sent: true, email };
  } catch (err) {
    return {
      error: messaggioAccesso(
        { message: err instanceof Error ? err.message : String(err) },
        'invio codice (eccezione)',
      ),
      email,
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
      error: messaggioAccesso(
        { message: err instanceof Error ? err.message : String(err) },
        'verifica codice (eccezione)',
      ),
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
