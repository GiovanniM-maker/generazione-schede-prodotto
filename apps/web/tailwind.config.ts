import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tema "Verificato": rosso brand + neutri caldi. Il rosso è per i
        // momenti di brand/azione; gli stati (ok/avviso/errore) restano semantici.
        brand: {
          DEFAULT: '#17130f',
          muted: '#6e655a',
          accent: '#e5322d',
          accentHover: '#c22b27',
          soft: '#fbe7e4',
        },
      },
    },
  },
  plugins: [],
};
export default config;
