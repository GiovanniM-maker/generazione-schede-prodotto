/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // I package @app/* sono TypeScript non compilati: Next li transpila.
  transpilePackages: ['@app/core', '@app/config', '@app/ai', '@app/database', '@app/pipeline'],
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
};
export default nextConfig;
