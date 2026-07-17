import Stripe from 'stripe';
import type { ServerEnv } from '@app/config';

// Helper Stripe. In mock billing mode non viene usato (accredito diretto in test).

export function getStripe(env: ServerEnv): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY mancante');
  // Usa la apiVersion di default dell'SDK installato (evita disallineamenti di tipo).
  return new Stripe(env.STRIPE_SECRET_KEY);
}

/** Mappa la chiave pacchetto al Stripe Price id configurato via env. */
export function priceIdForPack(env: ServerEnv, packKey: string): string | null {
  const map: Record<string, string> = {
    pack_50: env.STRIPE_PRICE_PACK_50,
    pack_200: env.STRIPE_PRICE_PACK_200,
    pack_500: env.STRIPE_PRICE_PACK_500,
  };
  return map[packKey] || null;
}

/** Mappa inversa: Stripe Price id -> chiave pacchetto. */
export function packForPriceId(env: ServerEnv, priceId: string): string | null {
  const map: Record<string, string> = {
    [env.STRIPE_PRICE_PACK_50]: 'pack_50',
    [env.STRIPE_PRICE_PACK_200]: 'pack_200',
    [env.STRIPE_PRICE_PACK_500]: 'pack_500',
  };
  return map[priceId] || null;
}
