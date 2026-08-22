'use client';

import { Loader2, Sparkles, Image as ImageIcon } from 'lucide-react';
import { type ImportResultV2 } from '@/lib/actions/batch-wizard';
import { type VerificaBatchResult } from '@/lib/actions/diritti';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avviso } from '@/components/ui/avviso';
import { type Completeness } from '@/lib/completeness';
import type { SampleCopy } from '@/components/batch/passi/tipi';
import { SampleOutput, SampleCompleteness, ControlloCrediti } from '@/components/batch/passi/pezzi';

// PROVA — vedere una scheda vera prima di farne mille.
//
// Passi 10 e 11: il campione su un prodotto solo, e la conferma con il
// controllo dei crediti.
// ---------------------------------------------------------------------------

export function Step10({
  sampleDone,
  busy,
  onRun,
  completeness,
  content,
}: {
  sampleDone: boolean;
  busy: boolean;
  onRun: () => void;
  completeness: Completeness | null;
  content: SampleCopy | null;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Genera un campione gratuito su un prodotto rappresentativo per verificare tono e correttezza
        prima della generazione in massa. Se il prodotto ha solo foto, l’AI legge prima le etichette
        in automatico.
      </p>
      {!sampleDone ? (
        <div data-tour="sample" className="inline-block">
          <Button onClick={onRun} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? 'Genero il campione…' : 'Genera campione'}
          </Button>
        </div>
      ) : (
        <>
          <Avviso tono="riuscito">Campione generato.</Avviso>
          {content && <SampleOutput content={content} />}
          {completeness && <SampleCompleteness completeness={completeness} />}
          <Button variant="outline" size="sm" onClick={onRun} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Rigenera campione
          </Button>
        </>
      )}
    </div>
  );
}

export function Step11({
  importSummary,
  diritti,
  notifyByEmail,
  setNotifyByEmail,
}: {
  importSummary: ImportResultV2 | null;
  diritti: VerificaBatchResult | null;
  notifyByEmail: boolean;
  setNotifyByEmail: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4" data-tour="launch">
      <Card>
        <CardContent className="space-y-3 p-5 text-sm text-ink-600">
          <p className="font-medium text-ink-900">Pronto per la generazione</p>
          {importSummary && (
            <ul className="list-inside list-disc space-y-1">
              <li>{importSummary.imported} prodotti importati</li>
              <li>{importSummary.valid} idonei alla generazione</li>
              {importSummary.imageOnly > 0 && <li>{importSummary.imageOnly} prodotti solo-immagini</li>}
            </ul>
          )}
          {importSummary && importSummary.imageOnly > 0 && (
            <div className="rounded-lg border border-brand-accent/30 bg-brand-accent/5 p-3 text-brand-accent">
              <p className="font-medium">Prodotti solo-immagini</p>
              <p className="mt-0.5 text-ink-600">
                All’avvio l’AI legge automaticamente le etichette delle foto ed estrae i dati (peso,
                ingredienti, valori nutrizionali…). I prodotti con abbastanza dati leggibili
                diventano idonei e vengono generati; l’eventuale conteggio «idonei» qui sopra si
                aggiorna dopo la lettura.
              </p>
            </div>
          )}
          <p>Verrà riservato 1 credito per ogni prodotto idoneo. La generazione avviene in background: puoi chiudere la pagina.</p>

          {/* I crediti, prima di premere.

              Prima questo riquadro non c'era e la risposta arrivava dal
              server dopo il clic: un 402 con scritto «Crediti insufficienti»
              e nient'altro — non quanti ne mancavano, non cosa comprare, e
              un rimando a una pagina chiamata col nome sbagliato. */}
          <ControlloCrediti diritti={diritti} />
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
            <input
              type="checkbox"
              checked={notifyByEmail}
              onChange={(e) => setNotifyByEmail(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-300"
            />
            <span>
              <span className="font-medium text-ink-800">Avvisami via email quando è pronto</span>
              <span className="mt-0.5 block text-ink-500">
                Ti mandiamo un’email all’indirizzo del tuo account appena la generazione finisce.
              </span>
            </span>
          </label>
          <div className="flex items-center gap-2 text-ink-500">
            <ImageIcon className="h-4 w-4" /> Potrai rivedere e correggere i risultati al termine.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
