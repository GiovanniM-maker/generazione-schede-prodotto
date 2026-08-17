import { redirect } from 'next/navigation';
import { Info } from 'lucide-react';
import { requireUser, getUserOrg } from '@/lib/auth';
import { getServerEnv } from '@/lib/env.server';
import { leggiDiritti } from '@/lib/entitlements';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avviso } from '@/components/ui/avviso';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { PurchaseButton } from '@/components/purchase-button';
import { PageShell } from '@/components/page-shell';
import { DatiFatturazioneForm } from '@/components/billing/dati-fatturazione-form';
import { leggiDatiFatturazione } from '@/lib/actions/fatturazione';
import { formattaPrezzo, prezzoPerCredito, NOME_MOVIMENTO } from '@app/core';
import { QuadroCrediti } from '@/components/billing/quadro-crediti';
import { Abbonamento } from '@/components/billing/abbonamento';

export const dynamic = 'force-dynamic';

interface PackRow {
  key: string;
  name: string;
  credits: number;
  price_cents: number | null;
  currency: string;
}
interface LedgerRow {
  amount: number;
  entry_type: string;
  created_at: string;
  metadata_json: { amount_cents?: number | null; currency?: string | null } | null;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const user = await requireUser();
  const mockBilling = getServerEnv().ENABLE_MOCK_BILLING;
  const { success, canceled } = await searchParams;
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');
  const isOwner = org.role === 'owner';

  const diritti = await leggiDiritti(org.organizationId);
  const supabase = await createSupabaseServerClient();

  const { data: ledgerData } = await supabase
    .from('credit_ledger')
    .select('amount, entry_type, created_at, metadata_json')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false })
    .limit(20);

  // Il listino arriva insieme al resto: una fonte sola per «cosa si può
  // comprare», la stessa che il wizard usa per dire quale pacchetto copre
  // l'ammanco. Due letture separate prima o poi divergono.
  const packs: PackRow[] = diritti.pacchetti.map((p) => ({
    key: p.chiave,
    name: p.nome,
    credits: p.crediti,
    price_cents: p.prezzoCent,
    currency: p.valuta,
  }));
  const ledger = (ledgerData ?? []) as LedgerRow[];
  const fatturazione = await leggiDatiFatturazione();

  return (
    <PageShell
      title="Fatturazione"
      subtitle="Gestisci i crediti della tua organizzazione."
    >
      {success && (
        <Avviso tono="riuscito">
          Acquisto completato. I crediti sono stati aggiunti al tuo saldo.
        </Avviso>
      )}
      {canceled && (
        <Avviso tono="informazione">
          Acquisto annullato. Nessun addebito effettuato.
        </Avviso>
      )}

      <QuadroCrediti diritti={diritti} />

      <Abbonamento diritti={diritti} isOwner={isOwner} />

      {/* Pacchetti */}
      <div id="pacchetti">
        <h2 className="text-lg font-semibold text-ink-900">
          Pacchetti di crediti
        </h2>
        {/* Quanto durano: era l'informazione che mancava, e adesso che i
            crediti scadono davvero tacerla sarebbe una vendita al buio. */}
        <p className="mt-1 text-sm text-ink-600">
          I crediti acquistati valgono dodici mesi dall’acquisto.
        </p>
        {/* Questo avviso vale SOLO quando la fatturazione è finta. Era scritto
            fisso: in produzione sarebbe rimasto a schermo nel punto in cui si
            incassa, dicendo che non si paga. `ENABLE_MOCK_BILLING` non può
            nemmeno essere true in produzione (lo impedisce lo schema di env),
            quindi era una frase falsa per costruzione. */}
        {mockBilling && (
          <div className="mt-2">
            {/* Era un riquadro blu scritto a mano. Il prodotto ha uno stile per
                gli avvisi informativi, ed è caldo come tutto il resto: il blu
                era l'unica cosa fredda su un fondo crema. */}
            <Avviso tono="informazione">
              In ambiente demo l’acquisto è simulato: i crediti vengono accreditati
              senza addebito reale.
            </Avviso>
          </div>
        )}
        {/* Un pulsante che il server rifiuterebbe non va offerto: si dice
            perché, invece di far sbattere contro un errore. */}
        {!isOwner && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <span>
              L’acquisto di crediti spetta al proprietario dell’organizzazione. Puoi
              usare i crediti disponibili per generare le tue schede.
            </span>
          </div>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {packs.length === 0 && (
            <p className="text-sm text-ink-500">
              Nessun pacchetto disponibile al momento.
            </p>
          )}
          {packs.map((p, i) => (
            <Card
              key={p.key}
              className={i === 1 ? 'border-brand-accent ring-1 ring-brand-accent' : ''}
            >
              <CardContent className="p-6 text-center">
                <div className="text-sm font-medium text-ink-500">{p.name}</div>
                {/* Il prezzo davanti: era l'unica cosa che mancava, e senza di
                    lui si compra alla cieca. */}
                <div className="mt-3 text-4xl font-bold text-ink-900">
                  {p.price_cents == null ? '—' : formattaPrezzo(p.price_cents, p.currency)}
                </div>
                <div className="text-sm text-ink-500">
                  {p.credits} crediti
                  {p.price_cents != null && (
                    <> · {prezzoPerCredito(p.price_cents, p.credits, p.currency)} a scheda</>
                  )}
                </div>
                {p.price_cents != null && (
                  <div className="mt-1 text-xs text-ink-500">IVA esclusa</div>
                )}
                <div className="mt-6">
                  {isOwner && (
                  <PurchaseButton
                    packKey={p.key}
                    variant={i === 1 ? 'primary' : 'outline'}
                  />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Dati per la fattura */}
      {fatturazione.ok && (
        <DatiFatturazioneForm iniziali={fatturazione.data} isOwner={isOwner} />
      )}

      {/* Cronologia */}
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Cronologia</h2>
        <Card className="mt-4">
          <CardContent className="p-0">
            {ledger.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-ink-500">
                Nessun movimento registrato.
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Data</TH>
                    <TH>Tipo</TH>
                    <TH className="text-right">Importo</TH>
                    <TH className="text-right">Crediti</TH>
                  </TR>
                </THead>
                <TBody>
                  {ledger.map((l, i) => (
                    <TR key={i}>
                      <TD className="text-ink-600">
                        {formatDate(l.created_at)}
                      </TD>
                      <TD>
                        <Badge tone="gray">
                          {NOME_MOVIMENTO[l.entry_type] ?? l.entry_type}
                        </Badge>
                      </TD>
                      {/* L'importo è quello pagato allora, non il prezzo di
                          oggi: i listini cambiano, una ricevuta no. Le righe
                          che non sono un pagamento (consumo, rilascio) non ne
                          hanno uno, e inventarne uno sarebbe peggio del
                          trattino. */}
                      <TD className="text-right tabular-nums text-ink-700">
                        {l.metadata_json?.amount_cents != null
                          ? formattaPrezzo(
                              l.metadata_json.amount_cents,
                              l.metadata_json.currency ?? 'EUR',
                            )
                          : '—'}
                      </TD>
                      <TD
                        className={
                          l.amount >= 0
                            ? 'text-right font-medium text-emerald-600'
                            : 'text-right font-medium text-ink-700'
                        }
                      >
                        {l.amount >= 0 ? `+${l.amount}` : l.amount}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
