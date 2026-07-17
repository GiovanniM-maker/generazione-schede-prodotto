'use client';

import { useActionState, use } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { ArrowLeft, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { signInWithEmail } from '@/lib/actions/auth';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Invio in corso…' : 'Invia link di accesso'}
    </Button>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: urlError } = use(searchParams);
  const [state, formAction] = useActionState(signInWithEmail, undefined);

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
              <h1 className="text-2xl font-semibold text-gray-900">Accedi</h1>
              <p className="mt-1 text-sm text-gray-500">
                Ti invieremo un link di accesso via email. Nessuna password da
                ricordare.
              </p>

              {urlError === 'auth' && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Il link di accesso non è valido o è scaduto. Richiedine uno
                    nuovo.
                  </span>
                </div>
              )}

              {state?.sent ? (
                <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  <div>
                    <p className="font-medium text-emerald-800">
                      Controlla la tua email
                    </p>
                    <p className="mt-1 text-sm text-emerald-700">
                      Ti abbiamo inviato un link di accesso. Apri il messaggio
                      per continuare.
                    </p>
                  </div>
                </div>
              ) : (
                <form action={formAction} className="mt-6 space-y-4">
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

                  {state?.error && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{state.error}</span>
                    </div>
                  )}

                  <SubmitButton />
                </form>
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
