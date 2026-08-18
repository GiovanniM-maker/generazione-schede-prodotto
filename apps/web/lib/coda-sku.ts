import {
  MAX_TENTATIVI,
  cacheUtilizzabile,
  daLavorare,
  mustWrite,
  normalizzaSku,
  type FornitoreRicerca,
} from '@app/core';
import type { Json } from '@app/database';
import { getServiceClient } from '@/lib/supabase/service';
import {
  creaContestoRete,
  risolviSku,
  riverificaPagina,
  type ContestoRete,
  type EsitoRisoluzione,
} from '@/lib/risolvi-sku';

// ---------------------------------------------------------------------------
// La coda a scaglioni: come una lista di cinquecento codici viene lavorata.
//
// Prima il tetto era venticinque per chiamata, e il resto della lista veniva
// tagliato via — con un commento che lo spiegava, che è il modo elegante di
// avere un prodotto che non fa quello che dice. Una lavorazione ora si svolge
// in più giri, e fra un giro e l'altro può passare un minuto o un giorno: lo
// stato non sta nella pagina di chi l'ha lanciata, sta nel registro.
//
// Il registro è tre cose insieme, e vale la pena tenerle distinte in testa:
//
//   la CODA        — le righe ci entrano prima di essere cercate;
//   la RIPRESA     — quello che è già deciso non si rifà, quindi chiudere il
//                    browser a metà costa il giro in corso e nient'altro;
//   la CACHE       — la stessa domanda fatta due volte si risponde una volta.
//
// Quello che NON fa, e non deve iniziare a fare: decidere. Le regole di cosa
// riprendere, quanto aspettare e quando una risposta vecchia vale ancora stanno
// in @app/core, provate col tempo passato come parametro. Qui c'è l'ordine in
// cui si applicano e le scritture che ne conseguono.
// ---------------------------------------------------------------------------

type Service = ReturnType<typeof getServiceClient>;

/** Quante righe al massimo in un giro: oltre, la richiesta scade comunque. */
export const MAX_PER_SCAGLIONE = 25;
/** Margine sotto il tempo della funzione serverless, per chiudere in ordine. */
export const BUDGET_SCAGLIONE_MS = 45_000;

export interface RigaCoda {
  id: string;
  codice_originale: string;
  marca_originale: string | null;
  sku_membri: string[];
  ambito: string[];
  esito: string;
  tentativi: number;
}

/**
 * Che fine ha fatto una riga, per chi deve creare il prodotto.
 *
 * `materializza` riceve la riga E i dati letti dalla pagina nello stesso
 * momento in cui l'identità è stata decisa. Non è un dettaglio di comodo: la
 * pagina rilettabile un istante dopo può essere già un'altra, e i fatti scritti
 * in scheda non sarebbero più quelli su cui l'aggancio è stato deciso.
 */
export type Materializza = (
  riga: RigaCoda,
  esito: EsitoRisoluzione,
) => Promise<{ ok: true } | { ok: false; error: string }>;

export interface DipendenzeCoda {
  service: Service;
  ricerca: FornitoreRicerca;
  materializza: Materializza;
  rete?: ContestoRete;
  adesso?: () => number;
}

export interface EsitoScaglione {
  /** Righe lavorate in questo giro. */
  lavorate: number;
  riusateDaCache: number;
  /** `true` quando non è rimasto niente da fare per questa lavorazione. */
  finita: boolean;
  /** Il registro non si è lasciato scrivere: il giro si è fermato lì. */
  interrotto: string | null;
  failures: Array<{ sku: string; reason: string }>;
}

/**
 * Lavora un giro della coda di un batch.
 *
 * Si ferma per uno di tre motivi, e sono tutti e tre normali: la coda è finita,
 * il giro ha fatto la sua quota, il tempo è scaduto. Chi chiama guarda `finita`
 * e richiama.
 */
export async function eseguiScaglione(
  dip: DipendenzeCoda,
  opzioni: { orgId: string; batchId: string; max?: number; budgetMs?: number },
): Promise<EsitoScaglione> {
  const { service } = dip;
  const adesso = dip.adesso ?? (() => Date.now());
  const rete = dip.rete ?? creaContestoRete();
  const max = opzioni.max ?? MAX_PER_SCAGLIONE;
  const scadenza = adesso() + (opzioni.budgetMs ?? BUDGET_SCAGLIONE_MS);

  const esito: EsitoScaglione = {
    lavorate: 0,
    riusateDaCache: 0,
    finita: false,
    interrotto: null,
    failures: [],
  };
  // Una riga fallita in questo giro non si ritenta in questo giro: l'attesa
  // progressiva serve a dare tempo a chi non risponde, e riprovare un istante
  // dopo lo stesso codice brucerebbe i suoi tre tentativi in mezzo secondo.
  const toccate = new Set<string>();

  for (;;) {
    if (esito.lavorate >= max) return esito;
    // Il tempo si guarda PRIMA di prendere la riga, non dopo averla lavorata:
    // una riga presa e non finita resterebbe in coda come se non fosse mai
    // partita, e al giro dopo si rifarebbe la ricerca già pagata.
    if (adesso() >= scadenza) return esito;

    const riga = await prossimaRiga(service, opzioni.batchId, toccate);
    if (!riga) {
      // «Finita» solo se non è rimasto niente: se restano righe già toccate in
      // questo giro, la coda continua al giro dopo.
      esito.finita = toccate.size === 0 || !(await restaLavoro(service, opzioni.batchId));
      return esito;
    }
    toccate.add(riga.id);

    const fallita = await lavoraRiga(dip, { rete, adesso }, opzioni.orgId, riga, esito);
    if (fallita) esito.failures.push(fallita);
    esito.lavorate++;
    // Se il registro non si lascia scrivere, insistere vuol dire rifare — e
    // ripagare — la stessa ricerca a ogni giro senza che ne resti traccia.
    if (esito.interrotto) return esito;
  }
}

/** La prossima riga da fare: prima quelle mai provate, poi quelle in errore. */
async function prossimaRiga(
  service: Service,
  batchId: string,
  saltare: Set<string>,
): Promise<RigaCoda | null> {
  const campi = 'id, codice_originale, marca_originale, sku_membri, ambito, esito, tentativi';
  const { data: nuove } = await service
    .from('sku_resolutions')
    .select(campi)
    .eq('batch_id', batchId)
    .eq('esito', 'in-coda')
    .order('creato_il', { ascending: true })
    .limit(1);
  const nuova = (nuove ?? [])[0];
  if (nuova) return nuova as RigaCoda;

  // Le righe in errore si riprovano solo quando non c'è più niente di nuovo:
  // un motore di ricerca che è caduto un minuto fa è probabilmente caduto
  // anche adesso, e riprovarle subito brucia il giro senza avanzare.
  const { data: daRiprovare } = await service
    .from('sku_resolutions')
    .select(campi)
    .eq('batch_id', batchId)
    .eq('esito', 'errore')
    // Il limite sui tentativi sta nella query e non in un controllo dopo: con
    // il controllo dopo, una riga esaurita in cima all'ordine avrebbe nascosto
    // tutte le altre e la coda si sarebbe fermata avendo ancora lavoro.
    .lt('tentativi', MAX_TENTATIVI)
    .order('aggiornato_il', { ascending: true })
    .limit(saltare.size + 1);
  const prossima = (daRiprovare ?? []).find((r) => !saltare.has(r.id));
  return (prossima as RigaCoda | undefined) ?? null;
}

/** `true` se la lavorazione ha ancora righe da fare, in questo giro o dopo. */
async function restaLavoro(service: Service, batchId: string): Promise<boolean> {
  const { data } = await service
    .from('sku_resolutions')
    .select('id, esito, tentativi')
    .eq('batch_id', batchId);
  return (data ?? []).some((r) => daLavorare({ esito: r.esito, tentativi: r.tentativi ?? 0 }));
}

async function lavoraRiga(
  dip: DipendenzeCoda,
  ambiente: { rete: ContestoRete; adesso: () => number },
  orgId: string,
  riga: RigaCoda,
  totali: EsitoScaglione,
): Promise<{ sku: string; reason: string } | null> {
  const { service } = dip;
  const richiesta = {
    codice: riga.codice_originale,
    marca: riga.marca_originale,
    domini: riga.ambito ?? [],
  };

  // 1) La stessa domanda è già stata fatta?
  const ripresa = await dallaCache(service, orgId, riga, ambiente.adesso());
  let esito: EsitoRisoluzione | null = null;
  let daCache = false;

  if (ripresa) {
    if (!ripresa.negativa && ripresa.url) {
      // La ricerca non si rifà; la pagina sì, e si ricontrolla che sia lei —
      // un indirizzo viene riusato, e un aggancio creduto sulla parola
      // scriverebbe in scheda i dati di un altro prodotto.
      const riverifica = await riverificaPagina(ripresa.url, richiesta, ambiente.rete);
      if (riverifica.risoluzione.scelto) {
        esito = riverifica;
        daCache = true;
      }
    } else if (ripresa.negativa) {
      esito = {
        risoluzione: {
          esito: 'non-trovato',
          scelto: null,
          valutati: [],
          punteggioIdentita: 0,
          motivo: ripresa.motivo,
        },
        estratto: null,
        escluseDaRobots: [],
        ricercaFallita: false,
      };
      daCache = true;
    }
  }

  // 2) Altrimenti si cerca davvero.
  if (!esito) esito = await risolviSku(dip.ricerca, richiesta, ambiente.rete);
  if (daCache) totali.riusateDaCache++;

  const { risoluzione } = esito;
  const quando = new Date(ambiente.adesso()).toISOString();

  // 3) Il registro, sempre: è quello che permette di riprendere e di spiegare.
  const scritta = {
    esito: esito.ricercaFallita ? 'errore' : risoluzione.esito,
    punteggio_identita: risoluzione.punteggioIdentita,
    url_scelto: risoluzione.scelto?.url ?? null,
    dominio_scelto: risoluzione.scelto?.dominio ?? null,
    livello_dominio: risoluzione.scelto?.livelloDominio ?? null,
    candidati_json: risoluzione.valutati.map((v) => ({
      url: v.candidato.url,
      titolo: v.candidato.titolo,
      marca: v.candidato.marcaPagina,
      dominio: v.candidato.dominio,
      livello: v.candidato.livelloDominio,
      prezzo: v.candidato.prezzo,
      immagine: v.candidato.immaginePrincipale,
      punteggio: v.punteggio,
    })) as unknown as Json,
    motivo: risoluzione.motivo,
    da_cache: daCache,
    // Il conto dei tentativi cresce solo quando si è fallito: una riga risolta
    // al terzo giro non deve restare a un passo dall'essere abbandonata.
    tentativi: esito.ricercaFallita ? (riga.tentativi ?? 0) + 1 : (riga.tentativi ?? 0),
    aggiornato_il: quando,
  };
  const registrata = await mustWrite(
    'sku_resolutions.update(esito)',
    service.from('sku_resolutions').update(scritta).eq('id', riga.id),
  );
  if (!registrata.ok) {
    totali.interrotto = registrata.error;
    return { sku: riga.codice_originale, reason: `Registro non aggiornato: ${registrata.error}` };
  }

  if (esito.ricercaFallita) {
    const ultimo = scritta.tentativi >= MAX_TENTATIVI;
    return {
      sku: riga.codice_originale,
      reason: ultimo ? `${risoluzione.motivo} (nessun altro tentativo)` : risoluzione.motivo,
    };
  }
  if (risoluzione.esito === 'non-trovato') {
    return { sku: riga.codice_originale, reason: risoluzione.motivo };
  }
  // Nessun campo si scrive finché l'identità non è confermata: è la regola che
  // impedisce una scheda in cui ogni dato è sbagliato pur essendo stato letto
  // benissimo.
  if (risoluzione.esito === 'coda-conferma') return null;

  const creato = await dip.materializza(riga, esito);
  if (!creato.ok) return { sku: riga.codice_originale, reason: creato.error };
  return null;
}

/**
 * La risposta già data alla stessa domanda, se vale ancora.
 *
 * Si guarda in tutte le lavorazioni dell'organizzazione, non solo in questa:
 * chi rilancia lo stesso catalogo il mese dopo sta facendo le stesse domande, e
 * rifarle costa a lui in attesa e a noi in chiamate.
 */
async function dallaCache(
  service: Service,
  orgId: string,
  riga: RigaCoda,
  adesso: number,
): Promise<{ url: string | null; negativa: boolean; motivo: string } | null> {
  const { data } = await service
    .from('sku_resolutions')
    .select('esito, url_scelto, dominio_scelto, ambito, aggiornato_il')
    .eq('organization_id', orgId)
    .eq('codice_normalizzato', normalizzaSku(riga.codice_originale).normalizzato)
    .eq('marca_normalizzata', (riga.marca_originale ?? '').trim().toLowerCase())
    // Senza questo si riprenderebbe la riga stessa, e la lavorazione
    // «riprenderebbe» all'infinito la propria risposta ancora da dare.
    .neq('id', riga.id)
    .order('aggiornato_il', { ascending: false })
    .limit(5);

  for (const voce of data ?? []) {
    const giudizio = cacheUtilizzabile(
      {
        esito: voce.esito,
        dominioScelto: voce.dominio_scelto,
        ambito: voce.ambito ?? [],
        aggiornatoIl: voce.aggiornato_il,
      },
      { adesso, domini: riga.ambito ?? [] },
    );
    if (giudizio.usa) {
      return {
        url: voce.url_scelto ?? null,
        negativa: voce.esito === 'non-trovato',
        motivo: giudizio.motivo,
      };
    }
  }
  return null;
}
