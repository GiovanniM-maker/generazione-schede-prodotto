'use server';

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import {
  parseCsv,
  parseXlsx,
  matchHeaders,
  buildProducts,
  groupVariants,
  computeQuality,
  type ColumnMapping,
} from '@app/core';
import { STORAGE_BUCKETS } from '@app/config';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBatchAccess } from '@/lib/ownership';

// ---------------------------------------------------------------------------
// Server actions per il flusso batch: creazione, upload+parse, import.
// La logica di parsing/qualità vive in @app/core; qui c'è la persistenza.
// ---------------------------------------------------------------------------

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export async function createBatchAction(input: {
  organizationId: string;
  name: string;
  presetVersionId?: string | null;
}): Promise<{ batchId: string }> {
  const user = await getSessionUser();
  if (!user) throw new Error('Non autenticato');
  const service = getServiceClient();

  // Verifica appartenenza all'organizzazione.
  const { data: member } = await service
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', input.organizationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) throw new Error('Organizzazione non accessibile');

  // Nel modello v2 il batch referenzia una versione pubblicata del preset,
  // passata esplicitamente (rework del flusso batch nella fase dedicata).
  const { data, error } = await service
    .from('batches')
    .insert({
      organization_id: input.organizationId,
      preset_version_id: input.presetVersionId ?? null,
      name: input.name || 'Nuovo batch',
      status: 'draft',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Creazione batch fallita: ${error?.message}`);

  await service.from('app_events').insert({
    organization_id: input.organizationId,
    user_id: user.id,
    event_name: 'batch_created',
    batch_id: data.id,
  });
  return { batchId: data.id };
}

export interface ParsePreview {
  sourceFileId: string;
  headers: string[];
  previewRows: Array<Record<string, string>>;
  suggestedMapping: ColumnMapping;
  duplicateFields: string[];
  totalRows: number;
}

/** Carica il file su storage, lo parsa e propone un mapping. */
export async function uploadAndParseAction(formData: FormData): Promise<ParsePreview> {
  const user = await getSessionUser();
  if (!user) throw new Error('Non autenticato');
  const batchId = String(formData.get('batchId') ?? '');
  const orgId = await assertBatchAccess(batchId);
  if (!orgId) throw new Error('Batch non accessibile');

  const file = formData.get('file');
  if (!(file instanceof File)) throw new Error('File mancante');

  const ext = extname(file.name).toLowerCase();
  if (ext !== '.csv' && ext !== '.xlsx') {
    throw new Error('Formato non supportato: usa CSV o XLSX');
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  const service = getServiceClient();
  const path = `${orgId}/${batchId}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
  const { error: upErr } = await service.storage
    .from(STORAGE_BUCKETS.sourceFiles)
    .upload(path, buffer, {
      contentType: ext === '.csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: false,
    });
  if (upErr) throw new Error(`Upload fallito: ${upErr.message}`);

  const { data: sf, error: sfErr } = await service
    .from('source_files')
    .insert({
      organization_id: orgId,
      batch_id: batchId,
      storage_bucket: STORAGE_BUCKETS.sourceFiles,
      storage_path: path,
      original_filename: file.name,
      mime_type: file.type || (ext === '.csv' ? 'text/csv' : 'application/octet-stream'),
      size_bytes: buffer.byteLength,
      sha256,
      status: 'ready',
    })
    .select('id')
    .single();
  if (sfErr || !sf) throw new Error(`Registrazione file fallita: ${sfErr?.message}`);

  const parsed = ext === '.csv' ? parseCsv(buffer) : await parseXlsx(buffer);
  const { matches } = matchHeaders(parsed.headers);
  const suggestedMapping: ColumnMapping = {};
  const duplicateFields: string[] = [];
  for (const m of matches) {
    if (m.fieldKey && (m.confidence === 'high' || m.confidence === 'medium')) {
      if (suggestedMapping[m.fieldKey]) duplicateFields.push(m.fieldKey);
      else suggestedMapping[m.fieldKey] = m.header;
    }
  }

  await service
    .from('batches')
    .update({ status: 'mapping', source_type: ext === '.csv' ? 'csv' : 'xlsx' })
    .eq('id', batchId);
  await service.from('app_events').insert({
    organization_id: orgId,
    user_id: user.id,
    event_name: 'file_uploaded',
    batch_id: batchId,
    metadata_json: { filename: file.name, rows: parsed.rows.length },
  });

  return {
    sourceFileId: sf.id,
    headers: parsed.headers,
    previewRows: parsed.rows.slice(0, 100),
    suggestedMapping,
    duplicateFields: [...new Set(duplicateFields)],
    totalRows: parsed.rows.length,
  };
}

export interface ImportResult {
  imported: number;
  valid: number;
  invalid: number;
}

/** Conferma il mapping, ricostruisce i prodotti e li importa. */
export async function confirmMappingAndImportAction(input: {
  batchId: string;
  sourceFileId: string;
  mapping: ColumnMapping;
}): Promise<ImportResult> {
  const user = await getSessionUser();
  if (!user) throw new Error('Non autenticato');
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) throw new Error('Batch non accessibile');

  const service = getServiceClient();
  const { data: sf } = await service
    .from('source_files')
    .select('storage_bucket, storage_path, mime_type, original_filename')
    .eq('id', input.sourceFileId)
    .single();
  if (!sf) throw new Error('File sorgente non trovato');

  const { data: blob, error: dlErr } = await service.storage
    .from(sf.storage_bucket)
    .download(sf.storage_path);
  if (dlErr || !blob) throw new Error(`Download fallito: ${dlErr?.message}`);
  const buffer = Buffer.from(await blob.arrayBuffer());

  const isCsv = sf.original_filename.toLowerCase().endsWith('.csv');
  const parsed = isCsv ? parseCsv(buffer) : await parseXlsx(buffer);
  const sourceType = isCsv ? 'csv' : 'xlsx';

  const built = buildProducts(parsed.rows, input.mapping, sourceType);
  const groups = groupVariants(built);

  // Pulisci import precedenti dello stesso batch (re-import).
  await service.from('products').delete().eq('batch_id', input.batchId);

  let valid = 0;
  let invalid = 0;
  let imported = 0;

  for (const group of groups) {
    const p = group.parent;
    const q = computeQuality(p);
    if (q.eligible) valid++;
    else invalid++;

    const { data: productRow, error: pErr } = await service
      .from('products')
      .insert({
        organization_id: orgId,
        batch_id: input.batchId,
        external_id: p.externalId,
        parent_external_id: p.parentExternalId,
        name: p.name,
        product_type: p.productType,
        category: p.category,
        raw_input_json: p.rawInput,
        canonical_attributes_json: p.canonicalAttributes,
        data_quality_score: q.score,
        verification_status: q.eligible ? 'eligible' : 'excluded',
      })
      .select('id')
      .single();
    if (pErr || !productRow) continue;
    imported++;

    // Evidenza per ogni fatto (provenienza).
    if (p.facts.length > 0) {
      await service.from('attribute_evidence').insert(
        p.facts.map((f) => ({
          organization_id: orgId,
          product_id: productRow.id,
          field_key: f.fieldKey,
          value_json: f.value,
          source_type: sourceType,
          source_file_id: input.sourceFileId,
          status: 'provided' as const,
        })),
      );
    }

    // Varianti.
    if (group.variants.length > 0) {
      await service.from('product_variants').insert(
        group.variants.map((v) => ({
          product_id: productRow.id,
          external_id: v.externalId,
          sku: v.sku,
          color: v.canonicalAttributes['color'] ?? null,
          size: v.canonicalAttributes['sizes'] ?? null,
          variant_attributes_json: v.canonicalAttributes,
        })),
      );
    }
  }

  await service
    .from('batches')
    .update({
      status: 'input_review',
      total_products: imported,
      valid_products: valid,
      invalid_products: invalid,
    })
    .eq('id', input.batchId);

  await service.from('batch_imports').insert({
    batch_id: input.batchId,
    source_file_id: input.sourceFileId,
    detected_headers_json: parsed.headers,
    confirmed_mapping_json: input.mapping,
    parse_summary_json: parsed.summary,
  });

  await service.from('app_events').insert({
    organization_id: orgId,
    user_id: user.id,
    event_name: 'mapping_confirmed',
    batch_id: input.batchId,
    metadata_json: { imported, valid, invalid },
  });

  return { imported, valid, invalid };
}

// ---------------------------------------------------------------------------
// Eliminazione batch (con conferma lato UI).
// ---------------------------------------------------------------------------

/**
 * Elimina un batch e tutti i dati collegati (prodotti, generazioni, job,
 * sorgenti) via cascade. Rifiuta se il batch è in coda/elaborazione per non
 * lasciare crediti riservati orfani o job attivi senza batch.
 */
export async function deleteBatchAction(input: {
  batchId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };
  const orgId = await assertBatchAccess(input.batchId);
  if (!orgId) return { ok: false, error: 'Batch non accessibile' };
  const service = getServiceClient();

  const { data: batch } = await service
    .from('batches')
    .select('status')
    .eq('id', input.batchId)
    .maybeSingle();
  if (!batch) return { ok: false, error: 'Batch non trovato' };
  if (batch.status === 'queued' || batch.status === 'processing') {
    return {
      ok: false,
      error: 'Il batch è in elaborazione: attendi il completamento prima di eliminarlo.',
    };
  }

  const { error } = await service.from('batches').delete().eq('id', input.batchId);
  if (error) return { ok: false, error: error.message };

  await service.from('app_events').insert({
    organization_id: orgId,
    user_id: user.id,
    event_name: 'batch_deleted',
    metadata_json: {},
  });
  return { ok: true };
}
