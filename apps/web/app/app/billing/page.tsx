import { redirect } from 'next/navigation';
import { Coins, CheckCircle2, Info, Beaker } from 'lucide-react';
import { requireUser, getUserOrg } from '@/lib/auth';
import { getServerEnv } from '@/lib/env.server';
import { getCreditBalance } from '@/lib/credits';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { PurchaseButton } from '@/components/purchase-button';
import { PageShell } from '@/components/page-shell';
import { DatiFatturazioneForm } from '@/components/billing/dati-fatturazione-form';
import { leggiDatiFatturazione } from '@/lib/actions/fatturazione';
import { formattaPrezzo, prezzoPerCredito } from '@app/core';

export const dynamic = 'force-dynamic';

const ENTRY_LABELS: Record<string, string> = {
  purchase: 'Acquisto',
  welcome: 'Benvenuto',
  reservation: 'Prenotazione',
  release: 'Rilascio',
  consumption: 'Consumo',
  refund: 'Rimborso',
  admin_adjustment: 'Rettifica',
};

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

  const credits = await getCreditBalance(org.organizationId);
  const supabase = await createSupabaseServerClient();

  const { data: packsData } = await supabase
    .from('billing_products')
    .select('key, name, credits, price_cents, currency')
    .eq('active', true)
    .order('credits', { ascending: true });

  const { data: ledgerData } = await supabase
    .from('credit_ledger')
    .select('amount, entry_type, created_at, metadata_json')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false })
    .limit(20);

  const packs = (packsData ?? []) as PackRow[];
  const ledger = (ledgerData ?? []) as LedgerRow[];
  const fatturazione = await leggiDatiFatturazione();

  return (
    <PageShell
      title="Fatturazione"
      subtitle="Gestisci i crediti della tua organizzazione."
    >
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Acquisto completato. I crediti sono stati aggiunti al tuo saldo.
        </div>
      )}
      {canceled && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          <Info className="h-4 w-4 shrink-0" />
          Acquisto annullato. Nessun addebito effettuato.
        </div>
      )}

      {/* Saldo */}
      <Card>
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <p className="text-sm text-gray-500">Saldo disponibile</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">
              {credits}{' '}
              <span className="text-base font-normal text-gray-500">
                crediti
              </span>
            </p>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
            <Coins className="h-6 w-6" />
          </span>
        </CardContent>
      </Card>

      {/* Pacchetti */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Pacchetti di crediti
        </h2>
        {/* Questo avviso vale SOLO quando la fatturazione è finta. Era scritto
            fisso: in produzione sarebbe rimasto a schermo nel punto in cui si
            incassa, dicendo che non si paga. `ENABLE_MOCK_BILLING` non può
            nemmeno essere true in produzione (lo impedisce lo schema di env),
            quindi era una frase falsa per costruzione. */}
        {mockBilling && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <Beaker className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              In ambiente demo l’acquisto è simulato: i crediti vengono accreditati
              senza addebito reale.
            </span>
          </div>
        )}
        {/* Un pulsante che il server rifiuterebbe non va offerto: si dice
            perché, invece di far sbattere contro un errore. */}
        {!isOwner && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            <span>
              L’acquisto di crediti spetta al proprietario dell’organizzazione. Puoi
              usare i crediti disponibili per generare le tue schede.
            </span>
          </div>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {packs.length === 0 && (
            <p className="text-sm text-gray-500">
              Nessun pacchetto disponibile al momento.
            </p>
          )}
          {packs.map((p, i) => (
            <Card
              key={p.key}
              className={i === 1 ? 'border-brand-accent ring-1 ring-brand-accent' : ''}
            >
              <CardContent className="p-6 text-center">
                <div className="text-sm font-medium text-gray-500">{p.name}</div>
                {/* Il prezzo davanti: era l'unica cosa che mancava, e senza di
                    lui si compra alla cieca. */}
                <div className="mt-3 text-4xl font-bold text-gray-900">
                  {p.price_cents == null ? '—' : formattaPrezzo(p.price_cents, p.currency)}
                </div>
                <div className="text-sm text-gray-500">
                  {p.credits} crediti
                  {p.price_cents != null && (
                    <> · {prezzoPerCredito(p.price_cents, p.credits, p.currency)} a scheda</>
                  )}
                </div>
                {p.price_cents != null && (
                  <div className="mt-1 text-xs text-gray-500">IVA esclusa</div>
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
        <h2 className="text-lg font-semibold text-gray-900">Cronologia</h2>
        <Card className="mt-4">
          <CardContent className="p-0">
            {ledger.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-gray-500">
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
                      <TD className="text-gray-600">
                        {formatDate(l.created_at)}
                      </TD>
                      <TD>
                        <Badge tone="gray">
                          {ENTRY_LABELS[l.entry_type] ?? l.entry_type}
                        </Badge>
                      </TD>
                      {/* L'importo è quello pagato allora, non il prezzo di
                          oggi: i listini cambiano, una ricevuta no. Le righe
                          che non sono un pagamento (consumo, rilascio) non ne
                          hanno uno, e inventarne uno sarebbe peggio del
                          trattino. */}
                      <TD className="text-right tabular-nums text-gray-700">
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
                            : 'text-right font-medium text-gray-700'
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
