import Link from 'next/link';
import { CheckCircle2, AlertCircle, LogIn } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { acceptInvitation } from '@/lib/actions/team';

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getSessionUser();

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        {children}
      </div>
    </div>
  );

  if (!user) {
    return (
      <Shell>
        <LogIn className="mx-auto h-8 w-8 text-brand-accent" />
        <h1 className="mt-3 text-lg font-semibold text-gray-900">Invito a un’organizzazione</h1>
        <p className="mt-2 text-sm text-gray-500">
          Per accettare l’invito, accedi con l’indirizzo email a cui è stato inviato, poi
          riapri questo link.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Vai all’accesso
        </Link>
      </Shell>
    );
  }

  const res = await acceptInvitation({ token });

  if (!res.ok) {
    return (
      <Shell>
        <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
        <h1 className="mt-3 text-lg font-semibold text-gray-900">Invito non valido</h1>
        <p className="mt-2 text-sm text-gray-500">{res.error}</p>
        <Link
          href="/app"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Vai all’app
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
      <h1 className="mt-3 text-lg font-semibold text-gray-900">Invito accettato</h1>
      <p className="mt-2 text-sm text-gray-500">
        Ora fai parte dell’organizzazione. Buon lavoro!
      </p>
      <Link
        href="/app"
        className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Entra nell’app
      </Link>
    </Shell>
  );
}
