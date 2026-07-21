import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0e1626',
          muted: '#64748b',
          accent: '#4f46e5',
          accentHover: '#4338ca',
          soft: '#eef2ff',
        },
      },
    },
  },
  plugins: [],
};
export default config;
