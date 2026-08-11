// Flat ESLint config condivisa (ESLint 9). Ogni package/app estende questa.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.*',
      '**/next-env.d.ts',
      'packages/database/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // -----------------------------------------------------------------------
    // Scritture al database: l'errore NON si butta via.
    //
    // Cinque volte lo stesso guaio: un valore non valido per lo schema, Postgres
    // che rifiuta, l'errore mai letto e l'app che dice "fatto". Sintomi diversi
    // ogni volta (Excel mai collegato, source_type NULL su tutti i batch,
    // crediti non accreditati), causa identica.
    //
    // Il selettore prende solo il caso pericoloso: `await x.insert(...)` come
    // istruzione a sé, con il risultato scartato. Se assegni il risultato
    // (`const { error } = await ...`) il nodo padre non è più un
    // ExpressionStatement e la regola non scatta.
    //
    // Per le scritture davvero best-effort (log, telemetria) usa `logWrite(...)`
    // da @app/core: dice a voce alta che l'errore è accettato.
    // -----------------------------------------------------------------------
    files: ['apps/**/*.ts', 'apps/**/*.tsx', 'packages/**/*.ts'],
    ignores: ['**/*.test.ts', '**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // La scrittura quasi mai è l'ultima chiamata della catena: la forma
          // vera è `.update({...}).eq('id', x)`. Quindi si cerca la write in
          // QUALSIASI punto dell'espressione attesa — compresa dentro un
          // Promise.all — e si esclude solo ciò che passa già dagli helper.
          selector:
            "ExpressionStatement > AwaitExpression:not(:has(CallExpression[callee.name=/^(mustWrite|writeOrThrow|logWrite|writeOrTrace|creditOp)$/])) CallExpression[callee.property.name=/^(insert|update|upsert|delete)$/]",
          message:
            "Scrittura al database con l'errore ignorato. Usa `const { error } = await ...` e controllalo, oppure uno degli helper: `mustWrite`/`writeOrThrow`/`logWrite` (@app/core), `writeOrTrace`/`creditOp` (@app/pipeline).",
        },
        {
          // `rpc` non passava dalla regola sopra, e sono proprio le funzioni
          // che toccano il registro dei crediti: accredito dopo il pagamento,
          // rimborso di una generazione fallita, consumo del credito riservato.
          // Un errore ignorato lì significa soldi che non tornano.
          selector:
            "ExpressionStatement > AwaitExpression:not(:has(CallExpression[callee.name=/^(mustWrite|writeOrThrow|logWrite|writeOrTrace|creditOp)$/])) CallExpression[callee.property.name='rpc']",
          message:
            "Chiamata `rpc` con l'errore ignorato. Sono le funzioni del registro crediti: usa `creditOp` da @app/pipeline.",
        },
      ],
    },
  },
);
