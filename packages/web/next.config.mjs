import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@hasna/assistants-core', '@node-rs/argon2', 'bun'],
  turbopack: {
    root: repoRoot,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize bun-specific modules on server
      config.externals = [...(config.externals || []), 'bun'];
    }
    return config;
  },
};

export default nextConfig;
