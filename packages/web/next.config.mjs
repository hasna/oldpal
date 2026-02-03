/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@hasna/assistants-core', '@node-rs/argon2', 'bun'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize bun-specific modules on server
      config.externals = [...(config.externals || []), 'bun'];
    }
    return config;
  },
};

export default nextConfig;
