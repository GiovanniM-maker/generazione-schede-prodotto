// ---------------------------------------------------------------------------
// Dati seminati per i test con browser.
//
// Percorrere sette passi di onboarding, caricare un file e aspettare la
// generazione a ogni test costerebbe minuti e chiamate all'AI. Qui si scrive
// direttamente lo stato finale — organizzazione, preset, batch, prodotti e
// schede già generate — così i test possono guardare le pagine che contano:
// il wizard e i risultati.
//
// Si scrive con la chiave di servizio, cioè scavalcando le regole di accesso:
// è legittimo perché stiamo COSTRUENDO lo stato, non simulando un utente. Il
// controllo degli accessi resta verificato dai test che passano dall'app.
// ---------------------------------------------------------------------------

import { deflateSync } from 'node:zlib';

const SETTORE_FOOD = '00000000-0000-0000-0f01-000000000001';

interface Config {
  url: string;
  service: string;
}

function config(): Config {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) throw new Error('Configurazione Supabase incompleta');
  return { url, service };
}

/** POST su PostgREST che RITORNA le righe e fallisce forte se qualcosa va storto. */
async function inserisci<T = Record<string, unknown>>(
  tabella: string,
  righe: Record<string, unknown>[],
): Promise<T[]> {
  const { url, service } = config();
  const risposta = await fetch(`${url}/rest/v1/${tabella}`, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(righe),
  });
  if (!risposta.ok) {
    throw new Error(`semina ${tabella}: ${risposta.status} ${await risposta.text()}`);
  }
  return (await risposta.json()) as T[];
}


/** Chiama una funzione SQL con la chiave di servizio. */
async function chiama(funzione: string, argomenti: Record<string, unknown>): Promise<void> {
  const { url, service } = config();
  const risposta = await fetch(`${url}/rest/v1/rpc/${funzione}`, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(argomenti),
  });
  if (!risposta.ok) {
    throw new Error(`semina rpc ${funzione}: ${risposta.status} ${await risposta.text()}`);
  }
}

/** PATCH su PostgREST, con errore parlante se fallisce. */
async function aggiorna(percorso: string, patch: Record<string, unknown>): Promise<void> {
  const { url, service } = config();
  const risposta = await fetch(`${url}/rest/v1/${percorso}`, {
    method: 'PATCH',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  if (!risposta.ok) throw new Error(`semina ${percorso}: ${risposta.status} ${await risposta.text()}`);
}

/**
 * Una foto finta ma vera: un PNG generato al volo, cosi' la vista in lettura ha
 * un'immagine da mostrare senza dipendere da file esterni.
 */
function pngDiProva(rosso: number, verde: number, blu: number): Buffer {
  const larghezza = 240;
  const altezza = 240;
  const righe: number[] = [];
  for (let y = 0; y < altezza; y++) {
    righe.push(0); // filtro "none"
    for (let x = 0; x < larghezza; x++) {
      // Sfumatura diagonale: si riconosce a colpo d'occhio in uno screenshot.
      const t = (x + y) / (larghezza + altezza);
      righe.push(
        Math.round(rosso * (0.55 + 0.45 * t)),
        Math.round(verde * (0.55 + 0.45 * t)),
        Math.round(blu * (0.55 + 0.45 * t)),
      );
    }
  }
  const idat = deflateSync(Buffer.from(righe));

  const blocco = (tipo: string, dati: Buffer): Buffer => {
    const lunghezza = Buffer.alloc(4);
    lunghezza.writeUInt32BE(dati.length);
    const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corpo) >>> 0);
    return Buffer.concat([lunghezza, corpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(larghezza, 0);
  ihdr.writeUInt32BE(altezza, 4);
  ihdr[8] = 8; // bit per canale
  ihdr[9] = 2; // colore RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocco('IHDR', ihdr),
    blocco('IDAT', idat),
    blocco('IEND', Buffer.alloc(0)),
  ]);
}

const TABELLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const b of buf) c = TABELLA_CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return c ^ -1;
}

export interface ScenarioSeminato {
  organizationId: string;
  presetVersionId: string;
  batchId: string;
  /** SKU dei prodotti creati, in ordine. */
  sku: string[];
  /** Nomi degli attributi di categoria, per ritrovarli nei risultati. */
  attributi: string[];
}

const PRODOTTI = [
  {
    sku: 'OLIO-500',
    nome: 'Olio EVO Coratina 500 ml',
    categoria: 'Olio EVO',
    fatti: { Formato: '500 ml', Origine: 'Puglia', Acidità: '0,3%' },
    titolo: 'Olio extravergine di oliva Coratina 500 ml',
    colore: [150, 190, 60] as const,
    // Confidenza bassa: la revisione deve segnalarla in modo evidente.
    confidenzaBassa: 'Acidità',
  },
  {
    sku: 'FORM-300',
    nome: 'Pecorino stagionato 300 g',
    categoria: 'Formaggi',
    fatti: { Formato: '300 g', Origine: 'Sardegna', Stagionatura: '12 mesi' },
    titolo: 'Pecorino sardo stagionato 12 mesi',
    colore: [220, 190, 120] as const,
    confidenzaBassa: null,
  },
  {
    sku: 'CONS-220',
    nome: 'Pomodori pelati 220 g',
    categoria: 'Conserve',
    fatti: { Formato: '220 g', Origine: 'Campania' },
    titolo: 'Pomodori pelati San Marzano 220 g',
    colore: [200, 70, 60] as const,
    confidenzaBassa: null,
  },
];

/** Carica una foto per prodotto e la collega, come farebbe un import vero. */
async function caricaFoto(
  organizationId: string,
  batchId: string,
  prodotti: typeof PRODOTTI,
  idProdotto: Map<string, string>,
): Promise<void> {
  const { url, service } = config();
  const bucket = 'product-assets';

  const [sorgente] = await inserisci<{ id: string }>('batch_sources', [
    { organization_id: organizationId, batch_id: batchId, source_type: 'images_upload', status: 'ready' },
  ]);

  for (const p of prodotti) {
    const png = pngDiProva(...p.colore);
    const percorso = `${organizationId}/${batchId}/${p.sku}.png`;
    const caricamento = await fetch(`${url}/storage/v1/object/${bucket}/${percorso}`, {
      method: 'POST',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: new Uint8Array(png),
    });
    if (!caricamento.ok) {
      throw new Error(`semina foto ${p.sku}: ${caricamento.status} ${await caricamento.text()}`);
    }

    const [file] = await inserisci<{ id: string }>('source_files', [
      {
        organization_id: organizationId,
        storage_bucket: bucket,
        storage_path: percorso,
        original_filename: `${p.sku}.png`,
        mime_type: 'image/png',
        size_bytes: png.length,
        sha256: `qa-${p.sku}`,
      },
    ]);
    const [item] = await inserisci<{ id: string }>('source_items', [
      {
        organization_id: organizationId,
        batch_source_id: sorgente!.id,
        source_file_id: file!.id,
        filename: `${p.sku}.png`,
        mime_type: 'image/png',
        size_bytes: png.length,
        sha256: `qa-${p.sku}`,
        detected_sku: p.sku,
        status: 'valid',
      },
    ]);
    await inserisci('product_source_links', [
      {
        organization_id: organizationId,
        product_id: idProdotto.get(p.sku),
        source_item_id: item!.id,
        link_type: 'sku_exact',
      },
    ]);
  }
}

/**
 * Costruisce un'organizzazione completa e pronta all'uso per l'utente dato:
 * preset Food con tre categorie, un batch con tre prodotti e le loro schede
 * già generate.
 */
/**
 * Un'organizzazione e basta: nessun settore, nessuna categoria, nessun preset.
 *
 * È lo stato di chi si è appena iscritto, ed è quello in cui il wizard è
 * BLOCCATO — «Nessun preset pubblicato» — cioè esattamente la condizione in
 * cui la guida a fumetti copriva l'unica via d'uscita. Senza questo scenario
 * quel difetto non è provabile: `seminaScenario` un preset ce l'ha, e il
 * wizard parte.
 *
 * La ripulitura è la stessa: `eliminaUtenteDiProva` cancella le organizzazioni
 * di cui l'utente è membro.
 */
export async function seminaOrganizzazioneNuda(userId: string): Promise<string> {
  const marca = Math.random().toString(36).slice(2, 8);
  const [org] = await inserisci<{ id: string }>('organizations', [
    { name: 'Bottega Nuova', slug: `qa-nuda-${marca}` },
  ]);
  await inserisci('organization_members', [
    { organization_id: org!.id, user_id: userId, role: 'owner' },
  ]);
  return org!.id;
}

/**
 * Un abbonamento attivo, con la disdetta già programmata.
 *
 * Serve a guardare il riquadro nello stato che conta: quello in cui il cliente
 * ha pagato e vuole smettere. Non passa da Stripe — qui si semina lo stato che
 * il webhook scriverebbe.
 */
export async function seminaAbbonamento(organizationId: string): Promise<void> {
  const ora = Date.now();
  await inserisci('subscriptions', [
    {
      organization_id: organizationId,
      stripe_subscription_id: `sub_qa_${Math.random().toString(36).slice(2, 10)}`,
      status: 'active',
      monthly_credits: 150,
      current_period_start: new Date(ora - 86_400_000).toISOString(),
      current_period_end: new Date(ora + 29 * 86_400_000).toISOString(),
      cancel_at_period_end: true,
    },
  ]);
}

export async function seminaScenario(userId: string): Promise<ScenarioSeminato> {
  const marca = Math.random().toString(36).slice(2, 8);

  const [org] = await inserisci<{ id: string }>('organizations', [
    { name: 'Cascina Verde S.r.l.', slug: `qa-cascina-${marca}` },
  ]);
  const organizationId = org!.id;
  await inserisci('organization_members', [
    { organization_id: organizationId, user_id: userId, role: 'owner' },
  ]);

  // I crediti di benvenuto, come li riceve chi si iscrive davvero.
  //
  // L'organizzazione qui si scrive a mano, senza passare da
  // `create_organization_for_user`: rapido, e per anni innocuo. Da quando i
  // crediti hanno una provenienza e una scadenza non lo è più — un'organizzazione
  // seminata senza un solo credito non è lo stato di nessun cliente, e le pagine
  // che parlano di crediti verrebbero provate nell'unico caso che non capita
  // mai.
  await chiama('grant_welcome_credits', { org: organizationId, amt: 10 });

  // Categorie e attributi dell'organizzazione (non di sistema): sono il
  // vocabolario del preset.
  const nomiCategorie = [...new Set(PRODOTTI.map((p) => p.categoria))];
  const categorie = await inserisci<{ id: string; name: string }>(
    'categories',
    nomiCategorie.map((name) => ({
      sector_id: SETTORE_FOOD,
      owner_organization_id: organizationId,
      name,
      status: 'active',
    })),
  );
  const idCategoria = new Map(categorie.map((c) => [c.name, c.id]));

  const nomiAttributi = [...new Set(PRODOTTI.flatMap((p) => Object.keys(p.fatti)))];
  const attributi = await inserisci<{ id: string; name: string }>(
    'attributes',
    nomiAttributi.map((name) => ({
      sector_id: SETTORE_FOOD,
      owner_organization_id: organizationId,
      name,
      attribute_kind: 'factual',
      data_type: 'text',
      is_system: false,
      status: 'active',
      version: 1,
    })),
  );
  const idAttributo = new Map(attributi.map((a) => [a.name, a.id]));

  const [preset] = await inserisci<{ id: string }>('presets', [
    { organization_id: organizationId, sector_id: SETTORE_FOOD, name: 'Preset Food', status: 'active' },
  ]);
  const [versione] = await inserisci<{ id: string }>('preset_versions', [
    // `published_at` valorizzato: il wizard propone solo i preset PUBBLICATI.
    // Una bozza non compare, ed e' giusto cosi'.
    { preset_id: preset!.id, version: 1, name: 'Preset Food', published_at: new Date().toISOString() },
  ]);
  const presetVersionId = versione!.id;
  // Senza la versione attiva il preset non compare fra quelli scegliibili nel
  // wizard: e' il campo che l'app usa per sapere quale versione servire.
  await aggiorna(`presets?id=eq.${preset!.id}`, { active_version_id: presetVersionId });
  await inserisci(
    'preset_categories',
    categorie.map((c, i) => ({
      preset_version_id: presetVersionId,
      category_id: c.id,
      display_order: i + 1,
      enabled: true,
    })),
  );
  await inserisci(
    'preset_attributes',
    attributi.map((a, i) => ({
      preset_version_id: presetVersionId,
      attribute_id: a.id,
      display_order: i + 1,
      enabled: true,
      is_required: false,
    })),
  );

  const [batch] = await inserisci<{ id: string }>('batches', [
    {
      organization_id: organizationId,
      name: 'Catalogo di prova',
      preset_version_id: presetVersionId,
      status: 'completed',
      source_type: 'spreadsheet',
      total_products: PRODOTTI.length,
      valid_products: PRODOTTI.length,
      invalid_products: 0,
    },
  ]);
  const batchId = batch!.id;

  const prodotti = await inserisci<{ id: string; sku: string }>(
    'products',
    PRODOTTI.map((p) => ({
      organization_id: organizationId,
      batch_id: batchId,
      sku: p.sku,
      external_id: p.sku,
      name: p.nome,
      category: p.categoria,
      category_id: idCategoria.get(p.categoria),
      preset_version_id: presetVersionId,
      raw_input_json: { sku: p.sku, nome: p.nome, ...p.fatti },
      canonical_attributes_json: { sku: p.sku, product_name: p.nome },
      verification_status: 'eligible',
      data_quality_score: 80,
    })),
  );
  const idProdotto = new Map(prodotti.map((p) => [p.sku, p.id]));

  await inserisci(
    'product_attribute_values',
    PRODOTTI.flatMap((p) =>
      Object.entries(p.fatti).map(([nome, valore]) => ({
        organization_id: organizationId,
        product_id: idProdotto.get(p.sku),
        attribute_id: idAttributo.get(nome),
        value_json: valore,
        status: 'provided',
        source_type: 'spreadsheet',
        // Una confidenza bassa per prodotto: la revisione deve renderla evidente.
        confidence: p.confidenzaBassa === nome ? 0.35 : 0.95,
      })),
    ),
  );

  // Una foto per prodotto: caricata su storage, registrata come sorgente e
  // collegata al prodotto, esattamente come farebbe un import vero.
  await caricaFoto(organizationId, batchId, PRODOTTI, idProdotto);

  const [run] = await inserisci<{ id: string }>('generation_runs', [
    {
      organization_id: organizationId,
      batch_id: batchId,
      run_type: 'product_copy',
      provider: 'mock',
      model: 'mock',
      prompt_version: 'qa',
      status: 'completed',
    },
  ]);

  await inserisci(
    'product_generations',
    PRODOTTI.map((p, i) => ({
      organization_id: organizationId,
      product_id: idProdotto.get(p.sku),
      generation_run_id: run!.id,
      input_hash: `qa-${marca}-${i}`,
      generated_content_json: {
        title: p.titolo,
        shortDescription: `${p.nome}. Prodotto italiano.`,
        longDescription: `${p.nome}: descrizione generata per la verifica dell'interfaccia. ${Object.entries(p.fatti).map(([k, v]) => `${k}: ${v}`).join('. ')}.`,
        bullets: Object.entries(p.fatti).map(([k, v]) => `${k}: ${v}`),
        metaDescription: `${p.titolo} — acquista online.`,
        faq: [{ question: 'Qual è il formato?', answer: String(p.fatti.Formato) }],
        altText: p.nome,
        usedFactKeys: Object.keys(p.fatti),
        warnings: [],
      },
      audit_json: { passed: true, unsupportedClaims: [], conflicts: [], severity: 'none' },
      completeness_json: { status: 'complete', missingAttributes: [], usedAttributes: Object.keys(p.fatti), reason: null },
      status: 'generated',
    })),
  );

  return {
    organizationId,
    presetVersionId,
    batchId,
    sku: PRODOTTI.map((p) => p.sku),
    attributi: nomiAttributi,
  };
}
