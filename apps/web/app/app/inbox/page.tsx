import { listOpenDoubtsAction } from '@/lib/actions/doubts';
import { InboxClient } from '@/components/inbox-client';
import { Avviso } from '@/components/ui/avviso';
import { PageShell } from '@/components/page-shell';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const res = await listOpenDoubtsAction();
  const doubts = res.ok ? res.data : [];

  return (
    <PageShell
      title="Dubbi dell’AI"
      subtitle="Quando l’AI legge un dato dalle foto senza esserne certa, te lo chiede qui. Le tue risposte correggono il prodotto e migliorano le letture successive."
    >
      {!res.ok ? (
        <Avviso tono="errore">{res.error}</Avviso>
      ) : (
        <InboxClient initial={doubts} />
      )}
    </PageShell>
  );
}
