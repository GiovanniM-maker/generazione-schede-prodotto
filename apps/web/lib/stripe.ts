import Stripe from 'stripe';
import type { ServerEnv } from '@app/config';

// Helper Stripe. In mock billing mode non viene usato (accredito diretto in test).

export function getStripe(env: ServerEnv): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY mancante');
  // Usa la apiVersion di default dell'SDK installato (evita disallineamenti di tipo).
  return new Stripe(env.STRIPE_SECRET_KEY);
}

/** La chiave del listino che identifica l'abbonamento mensile. */
export const CHIAVE_ABBONAMENTO = 'subscription';

/** Mappa la chiave del listino al Stripe Price id configurato via env. */
export function priceIdForPack(env: ServerEnv, packKey: string): string | null {
  const map: Record<string, string> = {
    pack_50: env.STRIPE_PRICE_PACK_50,
    pack_200: env.STRIPE_PRICE_PACK_200,
    pack_500: env.STRIPE_PRICE_PACK_500,
    [CHIAVE_ABBONAMENTO]: env.STRIPE_PRICE_SUBSCRIPTION,
  };
  return map[packKey] || null;
}

/** Mappa inversa: Stripe Price id -> chiave del listino. */
export function packForPriceId(env: ServerEnv, priceId: string): string | null {
  // Le variabili non configurate valgono stringa vuota: senza questo filtro
  // finirebbero tutte nella stessa chiave `''` e un prezzo sconosciuto
  // risulterebbe uno dei nostri.
  const coppie: [string, string][] = [
    [env.STRIPE_PRICE_PACK_50, 'pack_50'],
    [env.STRIPE_PRICE_PACK_200, 'pack_200'],
    [env.STRIPE_PRICE_PACK_500, 'pack_500'],
    [env.STRIPE_PRICE_SUBSCRIPTION, CHIAVE_ABBONAMENTO],
  ];
  const trovato = coppie.find(([id]) => id !== '' && id === priceId);
  return trovato ? trovato[1] : null;
}
