import { NextResponse } from 'next/server';
import { runVisualExtractionForBatch } from '@/lib/actions/visual';

// POST /api/batches/[batchId]/reanalyze — ri-analizza le immagini del batch
// (force): rilegge le etichette, ri-inferisce la categoria per i prodotti che
// non ce l'hanno e ricalcola l'eleggibilità. Non rigenera i testi.
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params;
  const res = await runVisualExtractionForBatch({ batchId, force: true });
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json(res.data);
}
