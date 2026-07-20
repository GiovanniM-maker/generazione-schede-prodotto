import { NextResponse } from 'next/server';
import { createAiProviders } from '@app/ai';
import {
  isSupportedLanguage,
  toTranslatableCopy,
  type LanguageCode,
  type ProductCopy,
  type TranslationsMap,
} from '@app/core';
import type { Json } from '@app/database';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser } from '@/lib/auth';
import { assertBatchAccess } from '@/lib/ownership';
import { getServiceClient } from '@/lib/supabase/service';
import { checkAiRateLimit } from '@/lib/rate-limit';

// POST /api/batches/[batchId]/translate  { languages: ['en','fr'], force?: boolean }
// Traduce l'ultima generazione di ogni prodotto nelle lingue scelte e salva in
// product_generations.translations_json. Idempotente: salta le lingue già
// tradotte (a meno di force). Preferisce il testo EDITATO al generato.
export const maxDuration = 300;

const CONCURRENCY = 4;
const TIME_BUDGET_MS = 250_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
  const orgId = await assertBatchAccess(batchId);
  if (!orgId) return NextResponse.json({ error: 'Batch non accessibile' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    languages?: string[];
    force?: boolean;
  };
  const languages = (body.languages ?? []).filter(isSupportedLanguage);
  if (languages.length === 0) {
    return NextResponse.json({ error: 'Scegli almeno una lingua valida' }, { status: 400 });
  }

  const rl = await checkAiRateLimit(orgId, 'translate');
  if (!rl.allowed) return NextResponse.json({ error: rl.message }, { status: 429 });

  const env = getServerEnv();
  const service = getServiceClient();
  const providers = createAiProviders(env);

  // Nome del settore del batch (per il lessico della traduzione).
  let sectorName: string | undefined;
  const { data: batch } = await service
    .from('batches')
    .select('preset_version_id')
    .eq('id', batchId)
    .maybeSingle();
  if (batch?.preset_version_id) {
    const { data: pv } = await service
      .from('preset_versions')
      .select('preset_id')
      .eq('id', batch.preset_version_id)
      .maybeSingle();
    if (pv?.preset_id) {
      const { data: preset } = await service
        .from('presets')
        .select('sector_id')
        .eq('id', pv.preset_id)
        .maybeSingle();
      if (preset?.sector_id) {
        const { data: s } = await service
          .from('sectors')
          .select('name')
          .eq('id', preset.sector_id)
          .maybeSingle();
        sectorName = s?.name ?? undefined;
      }
    }
  }

  // Ultima generazione per prodotto del batch.
  const { data: products } = await service
    .from('products')
    .select('id')
    .eq('batch_id', batchId);
  const productIds = (products ?? []).map((p) => p.id);
  if (productIds.length === 0) return NextResponse.json({ translated: 0, skipped: 0 });

  const { data: gens } = await service
    .from('product_generations')
    .select('id, product_id, generated_content_json, edited_content_json, translations_json, status, created_at')
    .in('product_id', productIds)
    .order('created_at', { ascending: false });
  const latestByProduct = new Map<string, NonNullable<typeof gens>[number]>();
  for (const g of gens ?? []) {
    if (!latestByProduct.has(g.product_id)) latestByProduct.set(g.product_id, g);
  }

  // Lavori: (generazione, lingua) mancanti.
  interface Job {
    genId: string;
    lang: LanguageCode;
    content: ReturnType<typeof toTranslatableCopy>;
  }
  const jobs: Job[] = [];
  let skipped = 0;
  const translationsByGen = new Map<string, TranslationsMap>();
  for (const gen of latestByProduct.values()) {
    if (gen.status === 'rejected') continue;
    const existing = ((gen.translations_json ?? {}) as TranslationsMap) || {};
    translationsByGen.set(gen.id, { ...existing });
    const generated = gen.generated_content_json as unknown as ProductCopy;
    const edited = (gen.edited_content_json ?? null) as Partial<ProductCopy> | null;
    // Il testo EDITATO (verificato dall'utente) vince sul generato.
    const content = toTranslatableCopy({ ...generated, ...(edited ?? {}) } as ProductCopy);
    if (!content.title && !content.longDescription) continue;
    for (const lang of languages) {
      if (!body.force && existing[lang]) {
        skipped++;
        continue;
      }
      jobs.push({ genId: gen.id, lang, content });
    }
  }

  // Traduzioni in parallelo con concorrenza limitata + budget di tempo.
  const deadline = Date.now() + TIME_BUDGET_MS;
  let translated = 0;
  let failed = 0;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < jobs.length && Date.now() < deadline) {
      const job = jobs[cursor++];
      if (!job) break;
      try {
        const res = await providers.translator.translateCopy({
          content: job.content,
          targetLanguage: job.lang,
          sectorName,
        });
        const map = translationsByGen.get(job.genId) ?? {};
        map[job.lang] = res.data;
        translationsByGen.set(job.genId, map);
        translated++;
      } catch (err) {
        failed++;
        console.warn(`[translate] fallita ${job.lang} per generazione ${job.genId}:`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  // Salvataggio per generazione (merge già fatto in memoria).
  for (const [genId, map] of translationsByGen) {
    await service
      .from('product_generations')
      .update({ translations_json: map as unknown as Json })
      .eq('id', genId);
  }

  const remaining = jobs.length - translated - failed;
  try {
    await service.from('app_events').insert({
      organization_id: orgId,
      user_id: user.id,
      event_name: 'batch_translated',
      batch_id: batchId,
      metadata_json: { languages, translated, skipped, failed, remaining } as unknown as Json,
    });
  } catch {
    /* storico best-effort */
  }

  return NextResponse.json({ translated, skipped, failed, remaining });
}
