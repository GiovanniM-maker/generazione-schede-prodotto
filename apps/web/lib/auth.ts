import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/supabase/service';
import { contestoApp } from '@/lib/contesto';
import { getServerEnv } from '@/lib/env.server';

// Helper di sessione e organizzazione.
//
// getSessionUser e getUserOrg sono memoizzati con React cache(): entro la STESSA
// richiesta (render di layout + pagina, oppure una singola server action) le
// chiamate ripetute vengono deduplicate. Senza questo, ogni azione pagava più
// volte la validazione del token (auth.getUser è una chiamata di rete) e la
// lookup dell'organizzazione — la causa principale della lentezza percepita.

export const getSessionUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

export interface OrgContext {
  organizationId: string;
  role: 'owner' | 'member';
}

/**
 * Ritorna l'organizzazione dell'utente (la prima). Null se assente.
 *
 * Passa da `contestoApp`, che nello stesso giro porta anche saldo crediti e
 * dubbi aperti. Sembra sprecato per chi vuole solo l'organizzazione, ma è il
 * contrario: l'intestazione dell'applicazione quei due numeri li chiede
 * comunque, e con la memoizzazione per richiesta la chiamata è **una sola** per
 * pagina invece delle tre in fila di prima. Tenere qui una query separata
 * significherebbe rimetterne una seconda.
 */
export const getUserOrg = cache(async (userId: string): Promise<OrgContext | null> => {
  const c = await contestoApp(userId);
  return c ? { organizationId: c.organizationId, role: c.role } : null;
});

/** Crea l'organizzazione dell'utente se non esiste (onboarding idempotente). */
export async function ensureOrg(userId: string, name: string): Promise<OrgContext> {
  const existing = await getUserOrg(userId);
  if (existing) return existing;
  const service = getServiceClient();
  const slug = `${slugify(name)}-${userId.slice(0, 8)}`;
  // `welcome_amt` non veniva passato: `WELCOME_CREDITS` stava in `.env.example`,
  // in `env.ts` e nella documentazione, e non arrivava a nessuno — il numero
  // vero era il valore predefinito della funzione SQL. Una manopola che non è
  // collegata a niente è peggio di una manopola che non c'è.
  const { data, error } = await service.rpc('create_organization_for_user', {
    user_id: userId,
    org_name: name,
    org_slug: slug,
    welcome_amt: getServerEnv().WELCOME_CREDITS,
  });
  if (error) throw new Error(`Creazione organizzazione fallita: ${error.message}`);
  return { organizationId: data as string, role: 'owner' };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'org';
}
