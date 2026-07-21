'use client';

import { useActionState, use } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { ArrowLeft, Mail, KeyRound, AlertCircle } from 'lucide-react';
import { signInWithEmail, verifyOtpCode, type SignInState } from '@/lib/actions/auth';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

function SubmitButton({ idle, pendingLabel }: { idle: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? pendingLabel : idle}
    </Button>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: urlError } = use(searchParams);
  const [emailState, sendCode] = useActionState<SignInState | undefined, FormData>(
    signInWithEmail,
    undefined,
  );
  const [codeState, verifyCode] = useActionState<SignInState | undefined, FormData>(
    verifyOtpCode,
    undefined,
  );

  // Siamo allo step "codice" appena l'email è stata inviata con successo.
  const email = codeState?.email ?? emailState?.email ?? '';
  const onCodeStep = Boolean(emailState?.sent);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)]">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <Card>
            <CardContent className="p-8">
              {!onCodeStep ? (
                <>
                  <h1 className="text-2xl font-semibold text-gray-900">Accedi</h1>
                  <p className="mt-1 text-sm text-gray-500">
                    Ti invieremo un <strong>codice a 6 cifre</strong> via email. Nessuna
                    password da ricordare.
                  </p>

                  {urlError === 'auth' && (
                    <div className="mt-4">
                      <ErrorBox message="Il link di accesso non è valido o è scaduto. Richiedi un nuovo codice." />
                    </div>
                  )}

                  <form action={sendCode} className="mt-6 space-y-4">
                    <div>
                      <Label htmlFor="email">Indirizzo email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input
                          id="email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          required
                          placeholder="nome@azienda.it"
                          className="pl-9"
                        />
                      </div>
                    </div>

                    {emailState?.error && <ErrorBox message={emailState.error} />}

                    <SubmitButton idle="Invia codice di accesso" pendingLabel="Invio in corso…" />
                  </form>
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-semibold text-gray-900">Inserisci il codice</h1>
                  <p className="mt-1 text-sm text-gray-500">
                    Abbiamo inviato un codice a 6 cifre a{' '}
                    <strong className="text-gray-700">{email}</strong>. Controlla la posta
                    (anche lo spam) e inseriscilo qui sotto.
                  </p>

                  <form action={verifyCode} className="mt-6 space-y-4">
                    <input type="hidden" name="email" value={email} />
                    <div>
                      <Label htmlFor="token">Codice di accesso</Label>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input
                          id="token"
                          name="token"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]*"
                          maxLength={6}
                          required
                          autoFocus
                          placeholder="123456"
                          className="pl-9 tracking-[0.4em]"
                        />
                      </div>
                    </div>

                    {codeState?.error && <ErrorBox message={codeState.error} />}

                    <SubmitButton idle="Verifica e accedi" pendingLabel="Verifica…" />
                  </form>

                  <form action={sendCode} className="mt-4 text-center">
                    <input type="hidden" name="email" value={email} />
                    <button
                      type="submit"
                      className="text-sm text-gray-500 underline-offset-2 hover:text-brand-accent hover:underline"
                    >
                      Non hai ricevuto il codice? Rinvialo
                    </button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Torna alla home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
