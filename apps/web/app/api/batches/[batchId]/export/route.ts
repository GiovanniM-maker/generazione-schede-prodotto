import { NextResponse } from 'next/server';
import { STORAGE_BUCKETS } from '@app/config';
import { getSessionUser } from '@/lib/auth';
import { assertBatchAccess } from '@/lib/ownership';
import { getServiceClient } from '@/lib/supabase/service';
import { buildBatchExport } from '@/lib/exporter';

// POST /api/batches/[batchId]/export  { format: 'csv' | 'xlsx' }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  const orgId = await assertBatchAccess(batchId);
  if (!orgId) return NextResponse.json({ error: 'Batch non accessibile' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { format?: string };
  const ALLOWED = ['csv', 'xlsx', 'shopify', 'woocommerce', 'prestashop'] as const;
  const format = (ALLOWED as readonly string[]).includes(body.format ?? '')
    ? (body.format as (typeof ALLOWED)[number])
    : 'csv';

  const service = getServiceClient();
  const result = await buildBatchExport(service, batchId, format);

  const path = `${orgId}/${batchId}/${crypto.randomUUID()}-export-${format}.${result.extension}`;
  const { error: uploadErr } = await service.storage
    .from(STORAGE_BUCKETS.exports)
    .upload(path, result.buffer, { contentType: result.contentType, upsert: false });
  if (uploadErr) {
    return NextResponse.json({ error: `Upload fallito: ${uploadErr.message}` }, { status: 500 });
  }

  // exports.format è un enum (csv/xlsx): gli export piattaforma sono file CSV,
  // la piattaforma va in mapping_json.
  const storedFormat = result.extension === 'xlsx' ? 'xlsx' : 'csv';
  await service.from('exports').insert({
    organization_id: orgId,
    batch_id: batchId,
    format: storedFormat,
    mapping_json: { platform: format },
    storage_bucket: STORAGE_BUCKETS.exports,
    storage_path: path,
    row_count: result.rowCount,
  });

  const { data: signed } = await service.storage
    .from(STORAGE_BUCKETS.exports)
    .createSignedUrl(path, 3600);

  await service.from('app_events').insert({
    organization_id: orgId,
    user_id: user.id,
    event_name: 'export_created',
    batch_id: batchId,
    metadata_json: { format, rowCount: result.rowCount },
  });

  return NextResponse.json({ url: signed?.signedUrl, rowCount: result.rowCount });
}
