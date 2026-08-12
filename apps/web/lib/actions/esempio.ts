'use server';

import { soloProprietario } from '@/lib/ownership';
import {
  createPreset,
  ensureDraftVersion,
  addCategoriesFromListToPreset,
  addAttributesFromListToPreset,
  publishPresetVersion,
  listSectors,
} from '@/lib/actions/catalog';

// ---------------------------------------------------------------------------
// Provare il prodotto senza rischiare.
//
// Fra l'iscriversi e il vedere una scheda generata c'erano cinque cose da
// configurare — settore, categorie, attributi, preset, pubblicazione — e nessuna
// di esse ha senso finché non hai visto cosa esce. Si chiedeva a qualcuno di
// costruire lo stampo prima di sapere che forma volesse.
//
// Questo monta un preset finito e pubblicato in un colpo solo. Non è una
// scorciatoia nascosta: usa **le stesse azioni** che userebbe una persona
// cliccando, una dopo l'altra. Se domani cambia il modo di creare un preset,
// cambia anche questo — invece di restare indietro in silenzio, che è come
// muoiono le scorciatoie.
// ---------------------------------------------------------------------------

type Esito<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Gli esempi, uno per settore.
 *
 * Sono scritti come li scriverebbe qualcuno che quel mestiere lo fa: le
 * categorie e gli attributi sono quelli veri di un listino di conserve o di un
 * catalogo di abbigliamento, non nomi di comodo.
 */
const ESEMPI: Record<string, { preset: string; categorie: string; attributi: string }> = {
  food: {
    preset: 'Esempio — conserve e sott’oli',
    categorie: 'Passate e sughi\nSott’oli\nConfetture',
    attributi:
      'Ingredienti\nPeso netto\nOrigine\nFormato confezione\nModalità di conservazione\nAllergeni',
  },
  moda: {
    preset: 'Esempio — abbigliamento',
    categorie: 'Capispalla\nMaglieria\nCamicie',
    attributi: 'Composizione\nVestibilità\nColore\nTaglie disponibili\nLavaggio\nPaese di produzione',
  },
  pharma: {
    preset: 'Esempio — integratori',
    categorie: 'Integratori alimentari\nDispositivi medici',
    attributi:
      'Principi attivi\nFormato\nPosologia\nAvvertenze\nConservazione\nNumero di notifica',
  },
};

/** L'esempio generico, per un settore che non ne ha uno suo. */
const GENERICO = {
  preset: 'Esempio — catalogo',
  categorie: 'Categoria di prova',
  attributi: 'Materiale\nDimensioni\nPeso\nColore\nOrigine',
};

export async function creaPresetDiEsempio(input: {
  sectorId?: string;
}): Promise<Esito<{ presetId: string; nome: string }>> {
  // Il preset è la forma delle schede di tutta l'organizzazione: lo mette chi
  // dell'organizzazione risponde.
  const permesso = await soloProprietario('creare un preset di esempio');
  if (!permesso.ok) return { ok: false, error: permesso.error };

  const settori = await listSectors();
  if (!settori.ok) return { ok: false, error: settori.error };
  const settore = input.sectorId
    ? settori.sectors.find((s) => s.id === input.sectorId)
    : settori.sectors[0];
  if (!settore) return { ok: false, error: 'Nessun settore disponibile' };

  const modello = ESEMPI[settore.key ?? ''] ?? GENERICO;

  const creato = await createPreset({ sectorId: settore.id, name: modello.preset });
  if (!creato.ok) return { ok: false, error: creato.error };

  const bozza = await ensureDraftVersion({ presetId: creato.presetId });
  if (!bozza.ok) return { ok: false, error: bozza.error };

  const cat = await addCategoriesFromListToPreset({
    presetVersionId: bozza.versionId,
    text: modello.categorie,
  });
  if (!cat.ok) return { ok: false, error: cat.error };

  const attr = await addAttributesFromListToPreset({
    presetVersionId: bozza.versionId,
    text: modello.attributi,
  });
  if (!attr.ok) return { ok: false, error: attr.error };

  // Un preset non pubblicato non serve a niente: il wizard non lo vede. Se la
  // pubblicazione fallisce lo si dice, invece di lasciare in giro una bozza e
  // una schermata che dice «fatto».
  const pubblicato = await publishPresetVersion({ presetId: creato.presetId });
  if (!pubblicato.ok) return { ok: false, error: pubblicato.error };

  return { ok: true, data: { presetId: creato.presetId, nome: modello.preset } };
}
