import { loadServerEnv } from '@app/config';

// Env server-only. NON importare da componenti client.
export function getServerEnv() {
  return loadServerEnv();
}
