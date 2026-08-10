import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Config root: raccoglie gli unit/integration test dei package E delle server
// action di apps/web — lo strato dove sono finiti quasi tutti i bug veri e che
// fino a ieri non aveva un solo test.
// I test e2e Playwright vivono in apps/web/e2e e restano esclusi.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web', import.meta.url)),
      // Marcatore Next per il codice solo-server: nei test non serve.
      'server-only': fileURLToPath(new URL('./apps/web/lib/__tests__/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/**/*.{test,spec}.ts',
      'apps/worker/**/*.{test,spec}.ts',
      'apps/web/**/*.{test,spec}.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/e2e/**'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
    },
  },
});
