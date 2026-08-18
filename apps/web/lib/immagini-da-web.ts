import { createHash } from 'node:crypto';
import {
  MAX_IMMAGINI_PRODOTTO,
  assegnaAlleVarianti,
  selezionaImmagini,
  type ImmagineCandidata,
  type LivelloDominio,
} from '@app/core';
import type { Json } from '@app/database';
import { STORAGE_BUCKETS } from '@app/config';
import { safeFetch } from '@/lib/safe-fetch';
import { getServiceClient } from '@/lib/supabase/service';
import { writeOrTrace } from '@app/pipeline';

// ---------------------------------------------------------------------------
// Le foto trovate su una pagina, portate dentro il catalogo del cliente.
//
// Quello che questo file È: si recuperano immagini che esistono già. Quello che
// NON è, e non deve diventare: nessuna immagine viene generata. Se un giorno
// comparisse un ramo che «crea» una foto per una variante che non ce l'ha,
// sarebbe un'altra funzione con un'altra promessa.
//
// Tre cose che sembrano dettagli e non lo sono:
//
//  1) I FILE SI SCARICANO, non si salva l'indirizzo. Un collegamento a un sito
//     di terzi si rompe o cambia contenuto: la scheda resterebbe senza
//     immagine, o peggio con l'immagine di un altro prodotto. L'indirizzo di
//     origine si conserva accanto al file, come provenienza.
//
//  2) SI DEDUPLICA SULL'IMPRONTA DEL FILE, non sull'indirizzo. La stessa foto
//     compare spesso più volte nella stessa pagina, e su più varianti, con URL
//     diversi (ridimensionamenti, parametri di cache). Contarla una volta sola
//     è quello che evita di pagarne lo storage otto volte.
//
//  3) OGNI IMMAGINE PORTA DA DOVE VIENE: la pagina, l'indirizzo del file, la
//     data del recupero e il livello del dominio. Serve per due domande
//     diverse: «questa foto da dove esce» e «posso pubblicarla».
// ---------------------------------------------------------------------------

const MAX_BYTE_IMMAGINE = 8_000_000;

function estensioneDa(contentType: string): string | null {
  const t = contentType.toLowerCase();
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('png')) return '.png';
  if (t.includes('webp')) return '.webp';
  return null;
}

export interface EsitoImmagini {
  scaricate: number;
  /** Scartate dalla selezione: loghi, badge, miniature. */
  scartate: number;
  /** Doppioni riconosciuti dall'impronta del file. */
  doppioni: number;
  /** Non scaricabili: irraggiungibili, troppo grandi, formato non gestito. */
  fallite: number;
}

export interface ContestoImmagini {
  orgId: string;
  batchId: string;
  productId: string;
  /** L'id della sorgente `images_upload` del batch, già creata da chi chiama. */
  batchSourceId: string;
  /** La pagina da cui provengono. */
  urlPagina: string;
  livelloDominio: LivelloDominio;
  /** Lo SKU del prodotto: dà il nome ai file. */
  sku: string;
  /** I valori di variante caricati dal cliente, per l'assegnazione. */
  valoriVariante?: string[];
}

/**
 * Sceglie, scarica e archivia le immagini di una pagina.
 *
 * La selezione è quella di `selezionaImmagini` in @app/core, provata a parte:
 * qui non si decide cosa è una foto di prodotto, si esegue.
 */
export async function scaricaImmaginiDaPagina(
  candidate: ImmagineCandidata[],
  ctx: ContestoImmagini,
): Promise<EsitoImmagini> {
  const service = getServiceClient();
  const bucket = STORAGE_BUCKETS.productAssets;

  const scelte = selezionaImmagini(candidate, { massimo: MAX_IMMAGINI_PRODOTTO });
  const assegnazione = assegnaAlleVarianti(scelte, ctx.valoriVariante ?? []);
  const varianteDi = new Map<string, string>();
  for (const [valore, immagini] of assegnazione.perVariante) {
    for (const i of immagini) varianteDi.set(i.url, valore);
  }

  const esito: EsitoImmagini = {
    scaricate: 0,
    scartate: Math.max(0, candidate.length - scelte.length),
    doppioni: 0,
    fallite: 0,
  };

  const improntePresenti = new Set<string>();
  const recuperataIl = new Date().toISOString();

  for (const immagine of scelte) {
    const risposta = await safeFetch(immagine.url, { maxBytes: MAX_BYTE_IMMAGINE, accept: 'image/*' });
    if (!risposta.ok || !risposta.contentType.toLowerCase().startsWith('image/')) {
      esito.fallite++;
      continue;
    }
    const estensione = estensioneDa(risposta.contentType);
    if (!estensione) {
      esito.fallite++;
      continue;
    }

    const contenuto = Buffer.from(risposta.bytes);
    const impronta = createHash('sha256').update(contenuto).digest('hex');
    if (improntePresenti.has(impronta)) {
      esito.doppioni++;
      continue;
    }
    // Lo stesso file può essere già arrivato da un'altra pagina dello stesso
    // batch: l'impronta lo riconosce anche allora, e non si ripaga lo storage.
    const { data: gia } = await service
      .from('source_files')
      .select('id')
      .eq('batch_id', ctx.batchId)
      .eq('sha256', impronta)
      .limit(1)
      .maybeSingle();
    if (gia) {
      improntePresenti.add(impronta);
      esito.doppioni++;
      continue;
    }
    improntePresenti.add(impronta);

    const percorso = `${ctx.orgId}/${ctx.batchId}/${crypto.randomUUID()}-web${estensione}`;
    const caricato = await service.storage
      .from(bucket)
      .upload(percorso, contenuto, { contentType: risposta.contentType, upsert: false });
    if (caricato.error) {
      esito.fallite++;
      continue;
    }

    const nomeFile = `${ctx.sku}-${esito.scaricate + 1}${estensione}`;
    const { data: file } = await service
      .from('source_files')
      .insert({
        organization_id: ctx.orgId,
        batch_id: ctx.batchId,
        storage_bucket: bucket,
        storage_path: percorso,
        original_filename: nomeFile,
        mime_type: risposta.contentType,
        sha256: impronta,
        size_bytes: contenuto.byteLength,
        status: 'ready',
      })
      .select('id')
      .single();
    if (!file) {
      esito.fallite++;
      continue;
    }

    const { data: voce } = await service
      .from('source_items')
      .insert({
        organization_id: ctx.orgId,
        batch_source_id: ctx.batchSourceId,
        source_file_id: file.id,
        filename: nomeFile,
        mime_type: risposta.contentType,
        size_bytes: contenuto.byteLength,
        detected_sku: ctx.sku,
        status: 'valid',
        metadata_json: {
          // Da qui si risponde a «questa foto da dove esce»: la pagina, il file
          // e quando. Una pagina cambia, e questa data dice quando era vero.
          daRicerca: true,
          urlPagina: ctx.urlPagina,
          urlFile: risposta.finalUrl,
          recuperataIl,
          livelloDominio: ctx.livelloDominio,
          // Chi può ripubblicarla non lo sappiamo, e non fingiamo di saperlo:
          // resta scritto che è materiale di terzi, e la verifica è del cliente.
          dirittiDaVerificare: true,
          altOriginale: immagine.alt ?? null,
          varianteDichiarata: varianteDi.get(immagine.url) ?? null,
        } as unknown as Json,
      })
      .select('id')
      .single();
    if (!voce) {
      esito.fallite++;
      continue;
    }

    // Senza il collegamento la foto è a database e non la trova nessuno:
    // niente analisi visiva, niente immagine nella scheda.
    await writeOrTrace(
      service,
      'product_source_links.insert(web)',
      service.from('product_source_links').insert({
        organization_id: ctx.orgId,
        product_id: ctx.productId,
        source_item_id: voce.id,
        link_type: 'sku_exact',
      }),
      { organizationId: ctx.orgId, batchId: ctx.batchId, refId: ctx.productId },
    );
    esito.scaricate++;
  }

  return esito;
}
