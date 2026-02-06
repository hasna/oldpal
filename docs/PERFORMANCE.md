# Web Performance Deployment Guide

This guide covers deployment optimizations for the web package to achieve optimal performance in production environments.

## Table of Contents

- [HTTP/3 (QUIC)](#http3-quic)
- [103 Early Hints](#103-early-hints)
- [Compression (Brotli/Zstd)](#compression-brotlizstd)
- [Caching Strategy](#caching-strategy)
- [CDN Configuration](#cdn-configuration)

## HTTP/3 (QUIC)

HTTP/3 uses QUIC as its transport layer, providing significant performance improvements over HTTP/2:

- **0-RTT connection establishment** - Faster initial connections
- **Multiplexing without head-of-line blocking** - Better handling of packet loss
- **Connection migration** - Sessions survive network changes (WiFi to cellular)

### When to Enable

Enable HTTP/3 when:
- Your CDN/reverse proxy supports it (Cloudflare, Fastly, AWS CloudFront)
- Target audience has modern browsers (Chrome 87+, Firefox 88+, Safari 14+)
- Your application makes many concurrent requests (asset loading, API calls)

### Configuration Examples

**Nginx (with quiche)**:
```nginx
server {
    listen 443 ssl http2;
    listen 443 quic reuseport;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Advertise HTTP/3 support
    add_header Alt-Svc 'h3=":443"; ma=86400';
}
```

**Caddy**:
```
yourdomain.com {
    # HTTP/3 is enabled by default in Caddy
}
```

**Cloudflare**: Enable in Dashboard > Speed > Optimization > Protocol Optimization

### References
- [RFC 9114: HTTP/3](https://www.rfc-editor.org/rfc/rfc9114)
- [Can I Use: HTTP/3](https://caniuse.com/http3)

## 103 Early Hints

Early Hints allow the server to send preload hints before the full response is ready, enabling browsers to start fetching critical assets earlier.

### When to Use

Use 103 Early Hints for:
- Critical CSS files
- Above-the-fold JavaScript bundles
- Preconnecting to required origins (API servers, CDNs)
- Font files needed for initial render

### Configuration Examples

**Next.js (experimental)**:
Early Hints support is being added to Next.js. For now, configure at the CDN/proxy level.

**Cloudflare**: Enable in Dashboard > Speed > Optimization > Early Hints

**Nginx**:
```nginx
location / {
    # Send early hints before proxying
    add_header Link "</styles/main.css>; rel=preload; as=style" early;
    add_header Link "</scripts/app.js>; rel=preload; as=script" early;

    proxy_pass http://localhost:3000;
}
```

### Critical Assets to Hint

For this application:
```
Link: </_next/static/css/[hash].css>; rel=preload; as=style
Link: </_next/static/chunks/main-[hash].js>; rel=preload; as=script
Link: </api/v1/auth/me>; rel=preconnect
```

### References
- [RFC 8297: Early Hints](https://www.rfc-editor.org/rfc/rfc8297)
- [web.dev: Early Hints](https://web.dev/early-hints/)

## Compression (Brotli/Zstd)

Modern compression algorithms provide better ratios than gzip while maintaining reasonable CPU usage.

### Compression Comparison

| Algorithm | Compression | Speed | Browser Support |
|-----------|-------------|-------|-----------------|
| Gzip      | Good        | Fast  | Universal       |
| Brotli    | Better      | Medium| 97%+ browsers   |
| Zstandard | Best        | Fast  | Limited (fetch) |

### Recommended Configuration

1. **Brotli** for static assets (JS, CSS, HTML, SVG, JSON)
2. **Gzip** as fallback for older browsers
3. **No compression** for already-compressed files (images, videos, woff2 fonts)

### Configuration Examples

**Nginx**:
```nginx
# Enable Brotli
brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css application/json application/javascript application/x-javascript text/javascript text/xml application/xml image/svg+xml;

# Gzip fallback
gzip on;
gzip_vary on;
gzip_comp_level 6;
gzip_types text/plain text/css application/json application/javascript text/javascript text/xml application/xml image/svg+xml;
```

**Cloudflare**: Enable Brotli in Dashboard > Speed > Optimization

### Pre-compression for Static Assets

Build-time compression improves performance by avoiding runtime CPU usage:

```bash
# Brotli pre-compression
find .next/static -type f \( -name "*.js" -o -name "*.css" \) -exec brotli -k {} \;

# Configure nginx to serve pre-compressed files
brotli_static on;
gzip_static on;
```

### References
- [Brotli Spec](https://www.rfc-editor.org/rfc/rfc7932)
- [Zstandard](https://facebook.github.io/zstd/)

## Caching Strategy

### Safe Defaults

**Never cache user-specific API responses:**
```
Cache-Control: no-store
```

Apply to:
- `/api/v1/auth/*` - Authentication endpoints
- `/api/v1/sessions/*` - User session data
- `/api/v1/messages/*` - User messages
- `/api/v1/assistants/*` - User assistants

**Cache static assets aggressively:**
```
Cache-Control: public, max-age=31536000, immutable
```

Apply to:
- `/_next/static/*` - Build artifacts with hashed filenames
- `/fonts/*` - Font files
- `/images/*` - Static images

**Cache public pages with revalidation:**
```
Cache-Control: public, max-age=0, must-revalidate
```

Apply to:
- Landing pages
- Public documentation

### Configuration Example

**Next.js headers** (already configured in next.config.js):
```javascript
async headers() {
  return [
    {
      source: '/_next/static/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
        },
      ],
    },
    {
      source: '/api/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'no-store',
        },
      ],
    },
  ];
}
```

## CDN Configuration

### Recommended CDN Settings

| Feature | Setting | Why |
|---------|---------|-----|
| HTTP/3 | Enabled | Faster connections |
| Brotli | Enabled | Better compression |
| Early Hints | Enabled | Faster asset loading |
| WebSockets | Enabled | Required for /api/v1/ws |
| Always HTTPS | Enabled | Security |
| Minimum TLS | 1.2+ | Security |

### Origin Shield

Enable origin shield to reduce load on your origin server:
- Single edge location fetches from origin
- Other edge locations fetch from shield
- Dramatically reduces origin requests during traffic spikes

### WebSocket Configuration

Ensure WebSocket connections are supported for `/api/v1/ws`:

**Cloudflare**: WebSockets enabled by default on Pro+ plans

**Nginx**:
```nginx
location /api/v1/ws {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

## Performance Monitoring

### Recommended Tools

- **Web Vitals** - Built into the application via `useWebVitals` hook
- **Lighthouse** - Chrome DevTools audit
- **WebPageTest** - Real-world performance testing
- **Vercel Analytics** - If deploying on Vercel

### Key Metrics to Monitor

| Metric | Target | Description |
|--------|--------|-------------|
| LCP | < 2.5s | Largest Contentful Paint |
| FID | < 100ms | First Input Delay |
| CLS | < 0.1 | Cumulative Layout Shift |
| TTFB | < 200ms | Time to First Byte |
| INP | < 200ms | Interaction to Next Paint |

## Checklist

Before deploying to production:

- [ ] HTTP/3 enabled at CDN/proxy
- [ ] Brotli compression enabled
- [ ] 103 Early Hints configured for critical assets
- [ ] API routes have `no-store` cache headers
- [ ] Static assets have immutable cache headers
- [ ] WebSocket endpoint is properly proxied
- [ ] TLS 1.2+ enforced
- [ ] Web Vitals monitoring active
