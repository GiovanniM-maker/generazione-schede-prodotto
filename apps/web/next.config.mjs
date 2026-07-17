/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // I package @app/* sono TypeScript non compilati: Next li transpila.
  transpilePackages: ['@app/core', '@app/config', '@app/ai', '@app/database', '@app/pipeline'],
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
  webpack: (config) => {
    // I package @app/* usano import ESM con estensione `.js` che puntano a
    // sorgenti `.ts`. Insegna a webpack a risolverli verso i file TypeScript.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
export default nextConfig;
