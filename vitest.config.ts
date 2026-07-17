import { defineConfig } from 'vitest/config';

// Config root: raccoglie gli unit/integration test dei package.
// I test e2e Playwright vivono in apps/web e non sono inclusi qui.
export default defineConfig({
  test: {
    include: ['packages/**/*.{test,spec}.ts', 'apps/worker/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/e2e/**'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
    },
  },
});
