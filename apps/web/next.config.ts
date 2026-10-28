import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// Next.js only reads .env files from this app's folder. Forge keeps one .env at the repo root
// (shared with the API), so load that instead. Next has already loaded (and cached) this app's
// own folder by now, so the reload must be forced. Variables already in the environment still win.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', console, true);

const apiOrigin = () => process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

// Matches the hostname only (Next strips the port before comparing).
const LOOPBACK_HOSTNAME = '(localhost|127\\.0\\.0\\.1|\\[::1\\])';

const config: NextConfig = {
  // Internal packages ship as TypeScript source.
  transpilePackages: ['@forge/shared'],
  // This is an npm-workspaces monorepo: tell Turbopack where the real root is.
  turbopack: { root: repoRoot },
  poweredByHeader: false,
  // The dev badge defaults to bottom-left, where it covers the sidebar's collapse button.
  devIndicators: { position: 'bottom-right' },
  // End-to-end tests build into their own folder so they can run beside a normal dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  // Every page: never framed by another site (the CLI approval page is the one that matters most,
  // since a framed Approve button could be clicked by trickery), no plugins, no foreign <base> or
  // form targets, and no referrer leaving this site (a CLI login code sits in the approval URL).
  // A full script policy needs per-request nonces for Next's own inline scripts; see
  // docs/known-limitations.md.
  async headers() {
    const always = [
      {
        key: 'Content-Security-Policy',
        value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
      },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    // Browsers ignore HSTS over plain HTTP, and localhost must stay reachable without TLS.
    const production =
      process.env.NODE_ENV === 'production'
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
        : [];
    return [{ source: '/:path*', headers: [...always, ...production] }];
  },

  // The browser talks to the API only through this same-origin proxy, so the session cookie is
  // first-party and never needs CORS. Server components call the API directly instead.
  async rewrites() {
    return [
      // The development account switcher is proxied only when the browser reached this server by
      // a loopback name. Anything else (for example a DNS-rebinding page) gets a plain 404.
      {
        source: '/api/dev/:path*',
        has: [{ type: 'host', value: LOOPBACK_HOSTNAME }],
        destination: `${apiOrigin()}/api/dev/:path*`,
      },
      { source: '/api/v1/:path*', destination: `${apiOrigin()}/api/v1/:path*` },
    ];
  },
};

export default config;
