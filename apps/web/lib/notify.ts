import 'server-only';
import type { getServiceClient } from '@/lib/supabase/service';

// Notifiche email (fine generazione). Invio via Resend API.
// Richiede RESEND_API_KEY tra le variabili d'ambiente. Finché non è verificato
// un dominio su Resend, il mittente resta onboarding@resend.dev (arriva solo al
// proprietario dell'account Resend). Con dominio verificato, imposta RESEND_FROM.

const RESEND_FROM = process.env.RESEND_FROM || 'Verificato <onboarding@resend.dev>';

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://generazione-schede-prodotto-web-iota.vercel.app').replace(/\/$/, '');
}

/**
 * Trova i batch terminati con notifica richiesta e non ancora inviata, invia
 * l'email e marca notified_at. Idempotente: "reclama" il batch con un update
 * condizionato prima di inviare, così cron/pagine concorrenti non fanno doppioni.
 * Best-effort: non lancia mai.
 */
export async function notifyCompletedBatches(
  service: ReturnType<typeof getServiceClient>,
): Promise<number> {
  let batches;
  try {
    const { data } = await service
      .from('batches')
      .select('id, name, processed_products, failed_products, total_products, notify_email')
      .in('status', ['completed', 'partial_failed', 'failed'])
      .not('notify_email', 'is', null)
      .is('notified_at', null)
      .limit(20);
    batches = data;
  } catch {
    return 0;
  }
  if (!batches?.length) return 0;

  const base = appBase();
  let sent = 0;
  for (const b of batches) {
    // Reclama atomicamente (evita invii doppi).
    const { data: claimed } = await service
      .from('batches')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', b.id)
      .is('notified_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) continue;

    const ok = (b.processed_products ?? 0) > 0;
    const failed = b.failed_products ?? 0;
    const link = `${base}/app/batches/${b.id}/results`;
    const subject = ok
      ? `Schede pronte: ${b.name}`
      : `Generazione non riuscita: ${b.name}`;
    const body = ok
      ? `<p>La generazione del batch <strong>${b.name}</strong> è terminata: <strong>${b.processed_products}</strong> schede pronte${
          failed ? ` (${failed} non riuscite)` : ''
        }.</p>`
      : `<p>La generazione del batch <strong>${b.name}</strong> non è riuscita. Apri il batch per vedere il motivo.</p>`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#17130f">
      <h2 style="font-size:20px;margin:0 0 8px;letter-spacing:-.02em">Verificato</h2>
      ${body}
      <p style="margin:16px 0 0"><a href="${link}" style="display:inline-block;background:#e5322d;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700">Apri i risultati</a></p>
    </div>`;
    if (await sendEmail(b.notify_email!, subject, html)) sent++;
  }
  return sent;
}
