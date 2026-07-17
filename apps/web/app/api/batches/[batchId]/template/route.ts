import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import {
  buildTemplateColumns,
  buildTemplateCsv,
  buildInstructions,
  IMAGE_NAMING_GUIDE,
  type TemplateAttribute,
} from '@app/core';
import { getSessionUser } from '@/lib/auth';
import { assertBatchAccess } from '@/lib/ownership';
import { getServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// GET /api/batches/[batchId]/template?format=csv|xlsx|guide
export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  const orgId = await assertBatchAccess(batchId);
  if (!orgId) return NextResponse.json({ error: 'Batch non accessibile' }, { status: 403 });

  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'csv';

  const service = getServiceClient();

  // Guida ai nomi immagine: indipendente dal preset.
  if (format === 'guide') {
    return new NextResponse(IMAGE_NAMING_GUIDE, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="guida-nomi-immagini.txt"',
      },
    });
  }

  const { data: batch } = await service
    .from('batches')
    .select('preset_version_id')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch?.preset_version_id) {
    return NextResponse.json({ error: 'Preset del batch non trovato' }, { status: 400 });
  }
  const presetVersionId = batch.preset_version_id;

  const { data: presetAttrs } = await service
    .from('preset_attributes')
    .select('attribute_id, is_required, display_order, enabled')
    .eq('preset_version_id', presetVersionId);
  const enabled = (presetAttrs ?? []).filter((a) => a.enabled !== false);
  const attrIds = enabled.map((a) => a.attribute_id);

  const { data: attrRows } = attrIds.length
    ? await service.from('attributes').select('id, key, name, description, data_type').in('id', attrIds)
    : { data: [] as { id: string; key: string | null; name: string; description: string | null; data_type: string }[] };

  const { data: version } = await service
    .from('preset_versions')
    .select('preset_id')
    .eq('id', presetVersionId)
    .maybeSingle();
  let sectorName = 'Settore';
  if (version?.preset_id) {
    const { data: preset } = await service
      .from('presets')
      .select('sector_id')
      .eq('id', version.preset_id)
      .maybeSingle();
    if (preset?.sector_id) {
      const { data: sector } = await service.from('sectors').select('name').eq('id', preset.sector_id).maybeSingle();
      sectorName = sector?.name ?? 'Settore';
    }
  }

  const attrById = new Map((attrRows ?? []).map((a) => [a.id, a]));
  const attributes: TemplateAttribute[] = enabled
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((pa) => {
      const attr = attrById.get(pa.attribute_id);
      return {
        key: attr?.key ?? pa.attribute_id,
        name: attr?.name ?? 'Attributo',
        required: pa.is_required,
        description: attr?.description ?? null,
        dataType: attr?.data_type ?? 'text',
      };
    });

  const columns = buildTemplateColumns({ sectorName, attributes });

  if (format === 'csv') {
    const csv = buildTemplateCsv(columns, { includeDescriptionRow: true, includeExampleRow: true });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="template-import.csv"',
      },
    });
  }

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Template');
    ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(40, Math.max(14, c.label.length + 4)) }));

    // Header in grassetto, obbligatori evidenziati.
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    columns.forEach((c, idx) => {
      const cell = headerRow.getCell(idx + 1);
      if (c.required) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } };
      }
    });
    headerRow.commit();

    // Riga descrizione ed esempio.
    ws.addRow(columns.map((c) => c.description ?? ''));
    ws.addRow(columns.map((c) => c.example ?? ''));
    ws.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };

    // Foglio istruzioni.
    const instr = wb.addWorksheet('Istruzioni');
    for (const line of buildInstructions({ sectorName, attributes }, columns)) {
      instr.addRow([line]);
    }
    instr.getColumn(1).width = 100;

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(arrayBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="template-import.xlsx"',
      },
    });
  }

  return NextResponse.json({ error: 'Formato non valido' }, { status: 400 });
}
