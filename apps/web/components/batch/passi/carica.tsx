'use client';

import { useState } from 'react';
import { Loader2, Check, UploadCloud, FileSpreadsheet, FileText, Download } from 'lucide-react';
import { type FoglioListaSku, type AnteprimaListaSku, type UploadSpreadsheetResult, type UploadImagesResult } from '@/lib/actions/batch-wizard';
import type { MappaturaListaSku } from '@app/core';
import { HelpBubble } from '@/components/onboarding/help-bubble';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avviso } from '@/components/ui/avviso';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SourceMode } from '@/components/batch/passi/tipi';
import { SOURCE_CARDS } from '@/components/batch/passi/definizioni';
import { PreviewTable, FilesTable } from '@/components/batch/passi/pezzi';

// CARICA — da dove arrivano i dati, e portarli dentro.
//
// Passi 3, 4 e 5: la scelta della fonte, le istruzioni con il template, e il
// caricamento vero con la sua anteprima.
// ---------------------------------------------------------------------------

export function Step3({
  sourceMode,
  setSourceMode,
  urlText,
  setUrlText,
  pdfFiles,
  setPdfFiles,
  skuText,
  setSkuText,
  skuDomini,
  setSkuDomini,
  skuRaggruppa,
  setSkuRaggruppa,
  skuAnteprima,
  skuFoglio,
  skuMappatura,
  setSkuMappatura,
  onCaricaFoglioSku,
  onAnteprimaSku,
  busy,
}: {
  sourceMode: SourceMode | null;
  setSourceMode: (m: SourceMode) => void;
  urlText: string;
  setUrlText: (v: string) => void;
  pdfFiles: File[];
  setPdfFiles: (f: File[]) => void;
  skuText: string;
  setSkuText: (v: string) => void;
  skuDomini: string;
  setSkuDomini: (v: string) => void;
  skuRaggruppa: boolean;
  setSkuRaggruppa: (v: boolean) => void;
  skuAnteprima: AnteprimaListaSku | null;
  skuFoglio: FoglioListaSku | null;
  skuMappatura: MappaturaListaSku | null;
  setSkuMappatura: (m: MappaturaListaSku) => void;
  onCaricaFoglioSku: (file: File) => void;
  onAnteprimaSku: () => void;
  busy: boolean;
}) {
  const urlCount = urlText.split(/\r?\n/).map((u) => u.trim()).filter(Boolean).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-500">
        Scegli da dove arrivano i dati dei prodotti. Puoi cambiare idea: se poi scopri di avere
        anche un Excel, torna a questo passo e scegli «Entrambe».
      </p>
      <div className="grid gap-3 sm:grid-cols-2" data-tour="sources">
        {SOURCE_CARDS.map((card) => {
          const active = card.mode !== null && card.mode === sourceMode;
          return (
            <button
              key={card.title}
              type="button"
              // `aria-disabled` e non `disabled`: una scheda spenta davvero si
              // salta col Tab, quindi chi usa la tastiera non scopre nemmeno
              // che Google Drive è in arrivo. Così la incontra, la legge, e
              // premerla non fa niente.
              aria-disabled={card.disabled || undefined}
              onClick={() => !card.disabled && card.mode && setSourceMode(card.mode)}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                card.disabled && 'cursor-not-allowed opacity-60',
                active ? 'border-brand-accent bg-brand-soft/70 ring-1 ring-brand-accent' : 'border-ink-200 bg-white hover:bg-ink-50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink-900">{card.title}</span>
                {/* Una fonte che si può usare e una che non c'è ancora
                    portavano la STESSA pastiglia viola: «Novità» accanto a «In
                    arrivo», stesso colore, stesso peso. Il viola dice «guarda
                    qui», e su una cosa che non si può cliccare è un invito a
                    vuoto. Ora il disponibile è viola e l'indisponibile è
                    grigio, come tutto il resto che non si può toccare. */}
                {card.disabled ? (
                  <Badge tone="gray">In arrivo</Badge>
                ) : (
                  card.note && <Badge tone="violet">{card.note}</Badge>
                )}
                {active && <Check className="h-4 w-4 shrink-0 text-brand-accent" />}
              </div>
              <p className="mt-1 text-sm text-ink-500">{card.description}</p>
            </button>
          );
        })}
      </div>

      {sourceMode === 'url' && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div>
              <Label htmlFor="url-list">Link delle pagine prodotto (uno per riga)</Label>
              <Textarea
                id="url-list"
                rows={7}
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                placeholder={'https://www.tuosito.it/prodotti/maglione-rosso\nhttps://www.fornitore.com/p/olio-evo-500ml'}
                className="mt-1 font-mono text-sm"
              />
              <p className="mt-1 text-xs text-ink-500">
                {urlCount > 0 ? `${urlCount} URL pronti · ` : ''}Massimo 60 per volta. Estraiamo nome,
                brand, prezzo, attributi e foto dai dati strutturati della pagina.
              </p>
            </div>
            <Avviso tono="attenzione" className="text-xs">
              Importa solo pagine di cui hai i diritti (tue o del tuo fornitore). L’AI riscrive una
              scheda nuova a partire dai fatti: non copiamo il testo originale.
            </Avviso>
          </CardContent>
        </Card>
      )}

      {sourceMode === 'sku' && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div>
              <Label htmlFor="sku-list">Codici articolo (uno per riga)</Label>
              <Textarea
                id="sku-list"
                rows={7}
                value={skuText}
                onChange={(e) => setSkuText(e.target.value)}
                onBlur={onAnteprimaSku}
                placeholder={'SED-AUR-01\nSED-AUR-02; Ferrini\nTAV-ORI-160'}
                className="mt-1 font-mono text-sm"
              />
              <p className="mt-1 text-xs text-ink-500">
                Puoi scrivere anche «codice; marca»: la marca serve a distinguere due produttori
                che usano lo stesso codice.
              </p>
            </div>

            {/* Il file, per chi i codici li ha già in un foglio. A duemila
                righe incollare non è un'opzione, e in quel foglio marca e
                codice modello di solito ci sono già: sono le due cose che
                alzano di più la precisione della ricerca. */}
            <div>
              <Label>Oppure carica un file con i codici</Label>
              <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 bg-white p-4 text-center text-sm text-ink-600 hover:bg-ink-50">
                <FileSpreadsheet className="h-5 w-5 text-ink-400" />
                {skuFoglio
                  ? `${skuFoglio.righeTotali} righe lette — clicca per cambiare file`
                  : 'Seleziona un file .csv o .xlsx'}
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onCaricaFoglioSku(f);
                  }}
                  data-testid="sku-file"
                />
              </label>
            </div>

            {skuFoglio && skuMappatura && (
              <div className="rounded-lg border border-ink-200 bg-white p-3">
                <div className="text-sm font-medium text-ink-900">Quale colonna è cosa</div>
                <p className="mt-0.5 text-xs text-ink-500">
                  Abbiamo provato a riconoscerle. Controlla: sbagliare la colonna dei codici vuol
                  dire cercare online la parola sbagliata, e ogni ricerca si paga.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['sku', 'Codice articolo (obbligatorio)'],
                      ['codiceModello', 'Codice modello'],
                      ['marca', 'Marca'],
                      ['attributoVariante', 'Colore o taglia'],
                      ['ambito', 'Sito su cui cercare'],
                    ] as Array<
                      ['sku' | 'codiceModello' | 'marca' | 'attributoVariante' | 'ambito', string]
                    >
                  ).map(([chiave, etichetta]) => (
                    <div key={chiave}>
                      <Label htmlFor={`sku-col-${chiave}`} className="text-xs">
                        {etichetta}
                      </Label>
                      <Select
                        aria-label={`Colonna del foglio per «${chiave}»`}
                        id={`sku-col-${chiave}`}
                        value={skuMappatura[chiave] ?? ''}
                        onChange={(e) =>
                          setSkuMappatura({ ...skuMappatura, [chiave]: e.target.value || null })
                        }
                        className="mt-0.5"
                      >
                        <option value="">— nessuna —</option>
                        {skuFoglio.intestazioni.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
                {!skuMappatura.sku && (
                  <p className="mt-2 text-xs text-red-600">
                    Senza la colonna dei codici non c’è niente da cercare.
                  </p>
                )}
                {skuMappatura.codiceModello && (
                  <p className="mt-2 text-xs text-ink-500">
                    Con il codice modello dichiarato non c’è niente da indovinare: il
                    raggruppamento viene dal tuo file.
                  </p>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="sku-domini">Cerca solo su questi siti (facoltativo)</Label>
              <Input
                id="sku-domini"
                value={skuDomini}
                onChange={(e) => setSkuDomini(e.target.value)}
                onBlur={onAnteprimaSku}
                // Invio fa quello che fa uscire dal campo: rigenera
                // l'anteprima. Prima non faceva NIENTE — il campo non sta in un
                // modulo — e nessuno se ne accorgeva perché `tastiera.test.ts`
                // guarda un file alla volta, e finché questa schermata viveva
                // dentro `wizard.tsx` le bastava il `<form>` del passo 1, che
                // con questo campo non c'entra niente. Il taglio l'ha scoperto.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAnteprimaSku();
                  }
                }}
                placeholder="ferrini.it, grossista.it"
                className="mt-1 font-mono text-sm"
              />
              <p className="mt-1 text-xs text-ink-500">
                Il sito del produttore o del fornitore. Alza molto la precisione, e i dati che
                arrivano da lì valgono più di quelli di un rivenditore qualsiasi.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 bg-white p-3">
              <input
                type="checkbox"
                checked={skuRaggruppa}
                onChange={(e) => {
                  setSkuRaggruppa(e.target.checked);
                  onAnteprimaSku();
                }}
                className="mt-1"
              />
              <span className="text-sm text-ink-700">
                Raggruppa i codici dello stesso modello in un prodotto con varianti
                <span className="mt-0.5 block text-xs text-ink-500">
                  Otto colori dello stesso articolo diventano una scheda sola: si paga un credito
                  invece di otto, e non escono otto descrizioni quasi identiche.
                </span>
              </span>
            </label>

            {/* L'anteprima dei costi sta QUI, dove si decide — non spiegata
                altrove. È l'unico momento in cui il numero cambia una scelta. */}
            {skuAnteprima && (
              <div className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm">
                <div className="font-medium text-ink-900">
                  {skuAnteprima.skuCaricati} codici → {skuAnteprima.prodotti}{' '}
                  {skuAnteprima.prodotti === 1 ? 'prodotto' : 'prodotti'}
                  {skuAnteprima.varianti > 0 && ` e ${skuAnteprima.varianti} varianti`}
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-ink-600">
                  <li>{skuAnteprima.risoluzioni} ricerche online</li>
                  <li>
                    {skuAnteprima.creditiConRaggruppamento} crediti di generazione
                    {skuAnteprima.creditiSenzaRaggruppamento > skuAnteprima.creditiConRaggruppamento &&
                      ` invece di ${skuAnteprima.creditiSenzaRaggruppamento} senza raggruppamento`}
                  </li>
                </ul>
                {skuAnteprima.regola && (
                  <div className="mt-2 border-t border-ink-200 pt-2 text-xs text-ink-600">
                    <div className="font-medium text-ink-700">Regola: {skuAnteprima.regola}</div>
                    {skuAnteprima.motivi.map((m) => (
                      <div key={m}>{m}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Avviso tono="attenzione" className="text-xs">
              I dati e le foto vengono da pagine di altri. Quello che troviamo su un sito che non è
              del produttore non basta a scrivere parole come «biologico» o «certificato»: la scheda
              tace su quel punto invece di dichiararlo. La verifica dei diritti sulle immagini resta
              a carico tuo.
            </Avviso>

          </CardContent>
        </Card>
      )}

      {sourceMode === 'pdf' && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div>
              <Label>Schede tecniche in PDF (una per prodotto)</Label>
              <label className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 bg-white p-6 text-center hover:bg-ink-50">
                <FileText className="h-6 w-6 text-ink-400" />
                <span className="text-sm text-ink-600">
                  {pdfFiles.length > 0
                    ? `${pdfFiles.length} ${pdfFiles.length === 1 ? 'PDF scelto' : 'PDF scelti'} — clicca per cambiare`
                    : 'Seleziona uno o più file .pdf'}
                </span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => setPdfFiles(Array.from(e.target.files ?? []))}
                  data-testid="pdf-input"
                />
              </label>
              {pdfFiles.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-500">
                  {pdfFiles.slice(0, 8).map((f) => (
                    <li key={f.name} className="truncate font-mono">
                      {f.name}
                    </li>
                  ))}
                  {pdfFiles.length > 8 && <li>e altri {pdfFiles.length - 8}…</li>}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-500">
                Massimo 50 per volta, 15 MB l’uno. Leggiamo le coppie «etichetta: valore» del
                documento — marca, codice, materiale, dimensioni — e il codice articolo diventa lo
                SKU.
              </p>
            </div>
            <Avviso tono="attenzione" className="text-xs">
              Serve un PDF con testo selezionabile: da una scansione o da una fotografia non si
              legge niente, e ve lo diciamo invece di importare una scheda vuota. La descrizione
              del fornitore non viene copiata: l’AI riscrive la scheda dai fatti.
            </Avviso>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function Step4({ batchId, hasSpreadsheet, hasImages, imageNamingGuide }: { batchId: string; hasSpreadsheet: boolean; hasImages: boolean; imageNamingGuide: string }) {
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-2 p-5 text-sm text-ink-600">
          <p className="font-medium text-ink-900">Regole SKU</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Ogni prodotto ha uno SKU univoco. Una riga per SKU.</li>
            <li>Lo SKU non può contenere underscore; sono ammessi lettere, numeri, trattini e punti.</li>
            <li>I dati forniti vengono usati come fatti: le informazioni assenti non verranno inventate.</li>
          </ul>
        </CardContent>
      </Card>

      {hasSpreadsheet && (
        <div className="flex flex-wrap gap-2">
          <a href={`/api/batches/${batchId}/template?format=csv`} className="inline-flex">
            <Button variant="outline" size="sm" type="button">
              <Download className="h-4 w-4" /> Template CSV
            </Button>
          </a>
          <a href={`/api/batches/${batchId}/template?format=xlsx`} className="inline-flex">
            <Button variant="outline" size="sm" type="button">
              <Download className="h-4 w-4" /> Template Excel
            </Button>
          </a>
          <a href={`/api/batches/${batchId}/template?format=guide`} className="inline-flex">
            <Button variant="outline" size="sm" type="button">
              <Download className="h-4 w-4" /> Guida nomi immagini
            </Button>
          </a>
        </div>
      )}

      {hasImages && (
        <Card>
          <CardContent className="p-5">
            <pre className="whitespace-pre-wrap font-sans text-sm text-ink-600">{imageNamingGuide}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function Step5({
  hasSpreadsheet,
  hasImages,
  busy,
  spreadsheetResult,
  imagesResult,
  uploadProgress,
  onUploadSpreadsheet,
  onCambiaFoglio,
  onUploadImages,
  skuDelimiter,
  onChangeDelimiter,
  reparsing,
}: {
  hasSpreadsheet: boolean;
  hasImages: boolean;
  busy: boolean;
  spreadsheetResult: UploadSpreadsheetResult | null;
  imagesResult: UploadImagesResult | null;
  uploadProgress: { done: number; total: number } | null;
  onUploadSpreadsheet: (file: File) => void;
  onCambiaFoglio: (foglio: string) => void;
  onUploadImages: (files: FileList | File[]) => void;
  skuDelimiter: '_' | '-' | '.' | ' ' | 'none';
  onChangeDelimiter: (d: '_' | '-' | '.' | ' ' | 'none') => void;
  reparsing: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="space-y-6">
      {hasSpreadsheet && (
        <div data-tour="upload-file">
          <Label>
            Foglio CSV o Excel{' '}
            <HelpBubble text="Serve una colonna con lo SKU (codice prodotto). Tutte le altre colonne potrai mapparle o importarle come dati extra nei passi successivi." />
          </Label>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 bg-white p-6 text-center hover:bg-ink-50">
            <FileSpreadsheet className="h-6 w-6 text-ink-400" />
            <span className="text-sm text-ink-600">Seleziona un file .csv o .xlsx</span>
            <input
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadSpreadsheet(f);
              }}
            />
          </label>
          {/* Provare il prodotto senza rischiare: chi arriva qui la prima volta
              spesso non ha un file pronto, e chi ce l'ha non vuole darlo a uno
              strumento che non ha ancora visto lavorare. Otto righe vere di un
              listino di conserve, da scaricare e ricaricare qui sopra: fa il
              giro completo senza mettere in mezzo il proprio catalogo. */}
          {!spreadsheetResult && (
            <p className="mt-2 text-xs text-ink-500">
              Non hai un file sotto mano?{' '}
              <a
                href="/listino-di-esempio.csv"
                download
                className="font-medium text-brand-accent underline underline-offset-2"
              >
                Scarica un listino di esempio
              </a>{' '}
              e ricaricalo qui sopra.
            </p>
          )}
          {spreadsheetResult && (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <Check className="h-4 w-4" /> {spreadsheetResult.file.filename} — {spreadsheetResult.totalRows} righe
              </div>
              {/* Excel con più fogli: si dice QUALE è stato letto e si lascia
                  scegliere. Un workbook con «Istruzioni» prima e «Listino»
                  dopo finiva per importare le istruzioni, in silenzio. */}
              {spreadsheetResult.sheets.length > 1 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <Label htmlFor="foglio-excel">
                    Questo file ha {spreadsheetResult.sheets.length} fogli: sto leggendo «
                    {spreadsheetResult.sheet}»
                  </Label>
                  <Select
                    id="foglio-excel"
                    value={spreadsheetResult.sheet ?? ''}
                    onChange={(e) => onCambiaFoglio(e.target.value)}
                    disabled={busy}
                  >
                    {spreadsheetResult.sheets.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1.5 text-xs text-amber-800">
                    Se i prodotti sono su un altro foglio, scegliilo qui: l’anteprima
                    qui sotto si aggiorna.
                  </p>
                </div>
              )}
              <PreviewTable headers={spreadsheetResult.headers} rows={spreadsheetResult.previewRows} />
            </div>
          )}
        </div>
      )}

      {hasImages && (
        <div data-tour="upload-images">
          <Label>
            Immagini prodotto{' '}
            <HelpBubble text="Il nome del file deve contenere lo SKU: es. «1234-fronte.jpg» → SKU 1234. Più foto con lo stesso SKU finiscono sullo stesso prodotto. Dopo il caricamento scegli il separatore giusto." />
          </Label>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) onUploadImages(e.dataTransfer.files);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center',
              dragOver ? 'border-brand-accent bg-brand-soft/70' : 'border-ink-300 bg-white hover:bg-ink-50',
            )}
          >
            <UploadCloud className="h-6 w-6 text-ink-400" />
            <span className="text-sm text-ink-600">Trascina qui le immagini o clicca per selezionarle (.jpg, .jpeg, .png, .webp, .zip)</span>
            <span className="text-xs text-ink-500">Caricamento diretto e in parallelo: veloce anche con centinaia di immagini.</span>
            <input
              aria-label="Scegli le foto dei prodotti"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.zip"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) onUploadImages(e.target.files);
              }}
            />
          </label>
          {uploadProgress && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-ink-500">
                <span>Caricamento immagini…</span>
                <span>
                  {uploadProgress.done}/{uploadProgress.total}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-brand-accent transition-all"
                  style={{
                    width: `${uploadProgress.total > 0 ? Math.round((uploadProgress.done / uploadProgress.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          {imagesResult && (
            <div className="mt-3 space-y-3 text-sm">
              <div className="rounded-lg border border-ink-200 bg-ink-50 p-3" data-tour="sku-separator">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-700">Separatore SKU:</span>
                  {([
                    { d: '_' as const, label: 'trattino_basso' },
                    { d: '-' as const, label: 'trattino -' },
                    { d: '.' as const, label: 'punto .' },
                    { d: ' ' as const, label: 'spazio' },
                    { d: 'none' as const, label: 'nessuno: il nome è lo SKU' },
                  ]).map((opt) => (
                    <button
                      key={opt.d}
                      type="button"
                      disabled={reparsing}
                      onClick={() => onChangeDelimiter(opt.d)}
                      className={
                        skuDelimiter === opt.d
                          ? 'rounded-lg border border-brand-accent bg-brand-accent px-2.5 py-1 text-xs font-medium text-white'
                          : 'rounded-lg border border-ink-300 bg-white px-2.5 py-1 text-xs text-ink-700 hover:border-ink-400'
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                  {reparsing && <Loader2 className="h-4 w-4 animate-spin text-ink-400" />}
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  Lo SKU è la parte del nome file <strong>prima</strong> del separatore. Es.
                  «100356-image_IT.jpg» con separatore «-» → SKU «100356». Le immagini con lo stesso
                  SKU vengono raggruppate sullo stesso prodotto.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone="green">{imagesResult.validCount} valide</Badge>
                <Badge tone="amber">{imagesResult.invalidCount} da controllare</Badge>
              </div>
              <FilesTable files={imagesResult.files} />
            </div>
          )}
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Caricamento in corso…
        </div>
      )}
    </div>
  );
}

/**
 * Verifica che i valori della colonna Categoria corrispondano a categorie del
 * catalogo. Quelli non riconosciuti vengono elencati e si possono rimappare a
 * mano su una categoria esistente (override passato all'import).
 */
