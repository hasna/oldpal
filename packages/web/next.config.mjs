import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Security headers configuration
const securityHeaders = [
  {
    // Content-Security-Policy - restricts resource loading
    // Note: 'unsafe-inline' for styles is needed for Tailwind CSS
    // 'unsafe-eval' removed for better security (not needed in production)
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // unsafe-inline needed for Next.js hydration
      "style-src 'self' 'unsafe-inline'", // unsafe-inline needed for Tailwind
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' wss: ws: https:",
      "frame-ancestors 'none'", // clickjacking protection (replaces X-Frame-Options for CSP-aware browsers)
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
  },
  {
    // Prevent clickjacking - fallback for browsers that don't support frame-ancestors in CSP
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // Prevent MIME type sniffing
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // Referrer policy - send referrer only to same origin
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // XSS protection (legacy, mostly handled by CSP now but still good to have)
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    // Permissions policy - restrict browser features
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
];

// HSTS header - only in production to avoid issues with local development
const hstsHeader = {
  key: 'Strict-Transport-Security',
  value: 'max-age=31536000; includeSubDomains; preload',
};

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
  // Add security headers to all routes
  async headers() {
    const headers = [...securityHeaders];

    // Only add HSTS in production to avoid HTTPS issues in development
    if (process.env.NODE_ENV === 'production') {
      headers.push(hstsHeader);
    }

    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers,
      },
      {
        // Apply to API routes with additional headers
        source: '/api/:path*',
        headers: [
          ...headers,
          {
            // Prevent caching of API responses by default
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
