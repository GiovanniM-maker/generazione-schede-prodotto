// ---------------------------------------------------------------------------
// Dove porta «Apri».
//
// Sta qui e non dentro la dashboard perché lo usano in due — la dashboard e
// l'elenco completo — e due copie di questa tabella divergerebbero al primo
// stato nuovo: una porterebbe al posto giusto e l'altra da qualche altra
// parte, senza che nessuno se ne accorga.
// ---------------------------------------------------------------------------

export function batchHref(id: string, status: string): string {
  switch (status) {
    // Un batch lasciato a metà torna nel WIZARD, che ora sa riprendersi dal
    // server. Prima 'mapping' portava a /app/batches/<id>/mapping — un relitto
    // della prima versione che diceva sempre «anteprima non più in memoria» e
    // parlava, cablato nel codice, del «preset Moda». Vicolo cieco raggiungibile
    // dalla dashboard: l'unica uscita era ricominciare da zero.
    case 'draft':
    case 'uploaded':
      return `/app/batches/new?batch=${id}`;
    case 'mapping':
      return `/app/batches/new?batch=${id}&passo=7`;
    case 'input_review':
      return `/app/batches/${id}/input`;
    case 'tone_setup':
    case 'sample_pending':
    case 'sample_ready':
      return `/app/batches/${id}/sample`;
    case 'approved':
    case 'queued':
    case 'processing':
      return `/app/batches/${id}/processing`;
    case 'completed':
    case 'partial_failed':
    case 'failed':
      return `/app/batches/${id}/results`;
    default:
      return `/app/batches/${id}/input`;
  }
}
