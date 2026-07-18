import { NextResponse } from 'next/server';
import { createAiProviders } from '@app/ai';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { checkAiRateLimit } from '@/lib/rate-limit';

// POST /api/copilot/transcribe — trascrive un singolo file audio (multipart
// form-data, campo `audio`) e restituisce il testo. NON invia mai nulla in chat
// e NON persiste l'audio: privacy by default → trascrivi-e-scarta.
//
// TODO(AUDIO_STORE): in futuro, dietro un flag opt-in (es. AUDIO_STORE=true),
// si potrà archiviare l'audio originale per audit/qualità. Oggi il Buffer vive
// solo per la durata della richiesta e non viene mai scritto su disco/DB.

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB

const ALLOWED_MIME_PREFIXES = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/x-m4a',
  'audio/aac',
];

function isAllowedMime(mimeType: string): boolean {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return ALLOWED_MIME_PREFIXES.includes(base);
}

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  // Rate limit sempre applicato: se l'utente non ha org, usa il suo id come
  // chiave (evita abuso della trascrizione a pagamento da account org-less).
  const org = await getUserOrg(user.id);
  const rlKey = org?.organizationId ?? user.id;
  const rl = await checkAiRateLimit(rlKey, 'transcribe');
  if (!rl.allowed) return NextResponse.json({ error: rl.message }, { status: 429 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Richiesta non valida: attesa form-data.' }, { status: 400 });
  }

  const audio = form.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'File audio mancante.' }, { status: 400 });
  }

  const mimeType = audio.type || 'application/octet-stream';
  if (!isAllowedMime(mimeType)) {
    return NextResponse.json(
      { error: `Formato audio non supportato: ${mimeType}.` },
      { status: 415 },
    );
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: 'File audio troppo grande (massimo 20 MB).' },
      { status: 413 },
    );
  }

  const arrayBuffer = await audio.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    return NextResponse.json({ error: 'File audio vuoto.' }, { status: 400 });
  }

  const filename = audio.name && audio.name.trim() ? audio.name : 'registrazione';

  try {
    const providers = createAiProviders(getServerEnv());
    const result = await providers.transcription.transcribe({
      audio: buffer,
      filename,
      mimeType,
      language: 'it',
    });
    // L'audio non viene persistito: il Buffer resta in memoria solo qui.
    return NextResponse.json({ text: result.data.text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Errore di trascrizione.' },
      { status: 500 },
    );
  }
}
