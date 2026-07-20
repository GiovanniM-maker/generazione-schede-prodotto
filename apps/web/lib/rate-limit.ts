import { getServiceClient } from '@/lib/supabase/service';

// Rate limiting per organizzazione sulle azioni AI (anti-abuso costi).
// Finestra fissa lato DB (consume_rate_limit). "Fail-open": se il controllo
// stesso fallisce per un errore infrastrutturale non blocchiamo l'utente.

export interface RateLimitConfig {
  max: number;
  windowSeconds: number;
}

export type AiAction =
  | 'copilot'
  | 'prompt_improve'
  | 'preset_plan'
  | 'visual'
  | 'sample'
  | 'transcribe';

export const AI_RATE_LIMITS: Record<AiAction, RateLimitConfig> = {
  copilot: { max: 30, windowSeconds: 60 },
  prompt_improve: { max: 10, windowSeconds: 60 },
  preset_plan: { max: 10, windowSeconds: 60 },
  visual: { max: 8, windowSeconds: 60 },
  sample: { max: 20, windowSeconds: 60 },
  transcribe: { max: 20, windowSeconds: 60 },
};

export interface RateLimitResult {
  allowed: boolean;
  /** Messaggio pronto per l'utente quando non consentito. */
  message: string;
}

export async function checkAiRateLimit(
  orgId: string,
  action: AiAction,
): Promise<RateLimitResult> {
  const cfg = AI_RATE_LIMITS[action];
  try {
    const service = getServiceClient();
    const { data, error } = await service.rpc('consume_rate_limit', {
      org: orgId,
      act: action,
      max_per_window: cfg.max,
      window_seconds: cfg.windowSeconds,
    });
    if (error) return { allowed: true, message: '' };
    if (data === true) return { allowed: true, message: '' };
    return {
      allowed: false,
      message: `Troppe richieste in poco tempo (max ${cfg.max} al minuto). Attendi qualche istante e riprova.`,
    };
  } catch {
    return { allowed: true, message: '' };
  }
}
