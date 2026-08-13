import { listOpenDoubtsAction } from '@/lib/actions/doubts';
import { InboxClient } from '@/components/inbox-client';
import { Avviso } from '@/components/ui/avviso';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const res = await listOpenDoubtsAction();
  const doubts = res.ok ? res.data : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Dubbi dell’AI</h1>
        <p className="mt-1 text-sm text-ink-500">
          Quando l’AI legge un dato dalle foto senza esserne certa, te lo chiede qui. Le tue
          risposte correggono il prodotto e migliorano le letture successive.
        </p>
      </div>
      {!res.ok ? (
        <Avviso tono="errore">{res.error}</Avviso>
      ) : (
        <InboxClient initial={doubts} />
      )}
    </div>
  );
}
