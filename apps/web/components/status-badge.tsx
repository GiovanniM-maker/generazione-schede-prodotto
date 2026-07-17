import { Badge, type BadgeTone } from '@/components/ui/badge';

// Mappa gli stati (batch / generazione / job / verifica) a etichette italiane e colori.
const MAP: Record<string, { label: string; tone: BadgeTone }> = {
  // Batch
  draft: { label: 'Bozza', tone: 'gray' },
  uploaded: { label: 'Caricato', tone: 'gray' },
  mapping: { label: 'Mappatura', tone: 'blue' },
  input_review: { label: 'Revisione dati', tone: 'blue' },
  tone_setup: { label: 'Tono', tone: 'blue' },
  sample_pending: { label: 'Campione in corso', tone: 'amber' },
  sample_ready: { label: 'Campione pronto', tone: 'blue' },
  approved: { label: 'Approvato', tone: 'green' },
  queued: { label: 'In coda', tone: 'amber' },
  processing: { label: 'In elaborazione', tone: 'amber' },
  completed: { label: 'Completato', tone: 'green' },
  partial_failed: { label: 'Completato con errori', tone: 'amber' },
  failed: { label: 'Fallito', tone: 'red' },
  canceled: { label: 'Annullato', tone: 'gray' },
  // Generazione
  generated: { label: 'Generato', tone: 'blue' },
  needs_review: { label: 'Da verificare', tone: 'amber' },
  accepted: { label: 'Accettato', tone: 'green' },
  rejected: { label: 'Rifiutato', tone: 'red' },
  // Verifica prodotto
  eligible: { label: 'Valido', tone: 'green' },
  excluded: { label: 'Escluso', tone: 'red' },
  partial: { label: 'Parziale', tone: 'amber' },
  verified: { label: 'Verificato', tone: 'green' },
  pending: { label: 'In attesa', tone: 'gray' },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge tone="gray">—</Badge>;
  const entry = MAP[status] ?? { label: status, tone: 'gray' as BadgeTone };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
