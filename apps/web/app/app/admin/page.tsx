import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { statoServizio } from '@/lib/actions/servizio';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avviso } from '@/components/ui/avviso';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { formattaPrezzo } from '@app/core';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Lo stato del servizio.
//
// Prima non c'era niente: nessun modo di sapere quante organizzazioni ci sono,
// quanto generano, quanto costa l'AI, chi è rimasto bloccato. Un servizio che
// non si guarda si scopre rotto dai clienti.
//
// Se `ADMIN_EMAILS` è vuota, o non contiene chi sta chiedendo, la pagina **non
// esiste**: 404 e non «non sei autorizzato», perché una pagina che dice «non sei
// autorizzato» conferma di esistere.
// ---------------------------------------------------------------------------

function Numero({
  etichetta,
  valore,
  nota,
}: {
  etichetta: string;
  valore: string;
  nota?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-gray-500">{etichetta}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{valore}</p>
        {nota && <p className="mt-0.5 text-xs text-gray-500">{nota}</p>}
      </CardContent>
    </Card>
  );
}

export default async function AdminPage() {
  await requireUser();
  const res = await statoServizio(30);
  if (!res.ok) notFound();
  const s = res.data;

  const numero = new Intl.NumberFormat('it-IT');
  const costo = new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(s.costoStimato);

  return (
    <PageShell
      title="Stato del servizio"
      subtitle={`Ultimi ${s.giorni} giorni. Visibile solo a chi è in ADMIN_EMAILS.`}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Numero
          etichetta="Organizzazioni"
          valore={numero.format(s.organizzazioni)}
          nota={`${s.organizzazioniNuove} nuove nel periodo`}
        />
        <Numero etichetta="Persone" valore={numero.format(s.persone)} />
        <Numero
          etichetta="Batch"
          valore={numero.format(s.batchTotali)}
          nota={`${s.batchNellaFinestra} nel periodo`}
        />
        <Numero etichetta="Schede generate" valore={numero.format(s.schedeGenerate)} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900">Soldi</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            etichetta="Incassato"
            valore={s.incassatoCentesimi > 0 ? formattaPrezzo(s.incassatoCentesimi) : '—'}
            nota={`${numero.format(s.creditiVenduti)} crediti venduti`}
          />
          <Numero
            etichetta="Crediti consumati"
            valore={numero.format(s.creditiConsumati)}
            nota="una scheda = un credito"
          />
          {/* `estimated_cost` è la stima del fornitore, non una fattura: il
              nome della colonna lo dice, e questa pagina non deve far credere
              il contrario. */}
          <Numero etichetta="Costo AI (stima)" valore={costo} nota="stima del fornitore" />
          <Numero
            etichetta="Token"
            valore={`${numero.format(s.tokenIngresso)} / ${numero.format(s.tokenUscita)}`}
            nota="ingresso / uscita"
          />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900">Chi è rimasto fermo</h2>
        <p className="mt-1 text-sm text-gray-500">
          Batch in uno stato non terminale da più di dieci minuti — la stessa soglia del
          riconciliatore, e per lo stesso motivo: sotto quella «fermo» vuol dire solo «sta
          lavorando».
        </p>
        <div className="mt-3">
          {s.batchBloccati.length === 0 ? (
            <Avviso tono="riuscito">Nessuno. Tutti i lavori sono arrivati in fondo.</Avviso>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Organizzazione</TH>
                      <TH>Batch</TH>
                      <TH>Stato</TH>
                      <TH className="text-right">Fermo da</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {s.batchBloccati.map((b) => (
                      <TR key={b.id}>
                        <TD className="text-gray-600">{b.organizzazione}</TD>
                        <TD className="font-medium text-gray-900">{b.nome}</TD>
                        <TD>
                          <Badge tone="amber">{b.stato}</Badge>
                        </TD>
                        <TD className="text-right tabular-nums text-gray-700">
                          {b.fermo_da_minuti} min
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900">Cosa si è rotto</h2>
        <p className="mt-1 text-sm text-gray-500">
          Scritture fallite, movimenti di credito non registrati ed errori non gestiti.{' '}
          {s.guastiTotali > s.guasti.length && `Mostrati gli ultimi ${s.guasti.length} di ${s.guastiTotali}.`}
        </p>
        <div className="mt-3">
          {s.guasti.length === 0 ? (
            <Avviso tono="riuscito">Niente nel periodo.</Avviso>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Quando</TH>
                      <TH>Evento</TH>
                      <TH>Dettagli</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {s.guasti.map((g, i) => (
                      <TR key={i}>
                        <TD className="whitespace-nowrap text-gray-600">
                          {new Date(g.quando).toLocaleString('it-IT')}
                        </TD>
                        <TD>
                          <Badge tone="red">{g.evento}</Badge>
                        </TD>
                        <TD className="max-w-md truncate font-mono text-xs text-gray-600">
                          {JSON.stringify(g.dettagli)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  );
}
