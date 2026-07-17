import { defineConfig } from 'tsup';

// Bundla il worker e i package @app/* in un singolo file ESM eseguibile.
// Le dipendenze npm (openai, supabase-js, dotenv) restano esterne (node_modules).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: [/^@app\//],
});
