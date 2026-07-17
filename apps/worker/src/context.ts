import 'dotenv/config';
import { loadServerEnv, type ServerEnv } from '@app/config';
import { createServiceClient, type TypedClient } from '@app/database';
import { createAiProviders } from '@app/ai';
import type { AiProviders } from '@app/ai';

// Costruisce env + client service-role + provider AI per il worker.

export interface WorkerContext {
  env: ServerEnv;
  client: TypedClient;
  providers: AiProviders;
}

export function buildContext(): WorkerContext {
  const env = loadServerEnv();
  const client = createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const providers = createAiProviders(env);
  return { env, client, providers };
}
