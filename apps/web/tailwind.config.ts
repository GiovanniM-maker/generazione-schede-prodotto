import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#111827', muted: '#6b7280', accent: '#2563eb' },
      },
    },
  },
  plugins: [],
};
export default config;
