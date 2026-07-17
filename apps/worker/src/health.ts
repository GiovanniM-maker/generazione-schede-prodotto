import 'dotenv/config';
import { loadServerEnv } from '@app/config';
import { createServiceClient } from '@app/database';

// Health check una tantum: verifica la connessione al database.
// Uso: `pnpm --filter worker health` oppure nel HEALTHCHECK del Dockerfile.

async function main(): Promise<void> {
  const env = loadServerEnv();
  const client = createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await client.from('billing_products').select('id').limit(1);
  if (error) {
    console.error(JSON.stringify({ status: 'error', error: error.message }));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: 'ok' }));
  process.exit(0);
}

main();
