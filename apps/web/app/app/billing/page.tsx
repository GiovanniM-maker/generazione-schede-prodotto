import { redirect } from 'next/navigation';
import { Coins, CheckCircle2, Info, Beaker } from 'lucide-react';
import { requireUser, getUserOrg } from '@/lib/auth';
import { getCreditBalance } from '@/lib/credits';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { PurchaseButton } from '@/components/purchase-button';

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
}
interface LedgerRow {
  amount: number;
  entry_type: string;
  created_at: string;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const user = await requireUser();
  const { success, canceled } = await searchParams;
  const org = await getUserOrg(user.id);
  if (!org) redirect('/app/onboarding');

  const credits = await getCreditBalance(org.organizationId);
  const supabase = await createSupabaseServerClient();

  const { data: packsData } = await supabase
    .from('billing_products')
    .select('key, name, credits')
    .eq('active', true)
    .order('credits', { ascending: true });

  const { data: ledgerData } = await supabase
    .from('credit_ledger')
    .select('amount, entry_type, created_at')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false })
    .limit(20);

  const packs = (packsData ?? []) as PackRow[];
  const ledger = (ledgerData ?? []) as LedgerRow[];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Fatturazione</h1>
        <p className="mt-1 text-sm text-gray-500">
          Gestisci i crediti della tua organizzazione.
        </p>
      </div>

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
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <Beaker className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            In ambiente demo l’acquisto è simulato: i crediti vengono accreditati
            senza addebito reale.
          </span>
        </div>
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
                <div className="mt-3 text-4xl font-bold text-gray-900">
                  {p.credits}
                </div>
                <div className="text-sm text-gray-500">crediti</div>
                <div className="mt-6">
                  <PurchaseButton
                    packKey={p.key}
                    variant={i === 1 ? 'primary' : 'outline'}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

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
    </div>
  );
}
