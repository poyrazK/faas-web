import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath, URL } from 'node:url';
import { mockApi } from './mock/plugin';

/**
 * Upstream API for `npm run dev`. In production the console and `apid` share
 * an origin, so nothing is proxied; locally the proxy reproduces that shape.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'https://api.gregale.dev';

/**
 * `npm run dev:mock`: answer the API locally from `mock/` instead of proxying
 * to a real `apid`. For working on the console when there is no backend to
 * talk to. The proxy is dropped entirely so nothing can leak through to the
 * real origin.
 */
const MOCK = process.env.MOCK_API === '1';

/**
 * Paths `apid` owns outright. `/auth/*` and `/oauth/*` are in here because
 * the OAuth consent and callback routes are real full-page navigations to the
 * server. The dashboard install endpoint is also a browser form POST: using
 * the proxy keeps the session cookie on this origin during local development.
 */
const API_PATHS = ['/v1', '/auth', '/dashboard/install', '/oauth'];

/**
 * `/login` and `/signup` are owned by *both* sides, split by method: this app
 * renders the form on GET, and `apid` answers the POST that sets the session
 * cookie. Proxying them wholesale serves apid's own htmx sign-in page instead
 * of this one — which is exactly what happened before this split existed.
 *
 * The same collision exists in production, so whatever fronts the deployment
 * has to route these two paths by method as well. See README § Deployment.
 */
const SHARED_PATHS = ['/login', '/signup'];

/**
 * The session cookie is issued `Domain=…gregale.dev; Secure`, and a browser
 * will not store either attribute against `http://localhost`. Stripping them
 * is what makes signing in work in dev; both are re-applied by the real server
 * in production, where this proxy does not exist.
 */
function localiseCookies(value: string | string[] | undefined): string[] {
  const cookies = Array.isArray(value) ? value : value ? [value] : [];
  return cookies.map((cookie) =>
    cookie
      .split(';')
      .filter((part) => {
        const name = part.trim().toLowerCase();
        return name !== 'secure' && !name.startsWith('domain=');
      })
      .join(';')
  );
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    ...(MOCK ? [mockApi()] : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: MOCK
      ? undefined
      : Object.fromEntries([
          ...API_PATHS.map((path) => [path, proxyEntry()]),
          // `bypass` returning a path makes Vite serve it locally instead of
          // proxying; returning undefined proxies as normal.
          ...SHARED_PATHS.map((path) => [
            path,
            proxyEntry((req) => (req.method === 'GET' ? '/index.html' : undefined)),
          ]),
        ]),
  },
});

function proxyEntry(bypass?: (req: { method?: string }) => string | undefined) {
  return {
    target: API_ORIGIN,
    changeOrigin: true,
    secure: true,
    bypass,
    configure: (proxy: {
      on: (
        event: 'proxyRes',
        handler: (res: { headers: Record<string, string | string[] | undefined> }) => void
      ) => void;
    }) => {
      proxy.on('proxyRes', (proxyRes) => {
        const cookies = proxyRes.headers['set-cookie'];
        if (cookies) proxyRes.headers['set-cookie'] = localiseCookies(cookies);
      });
    },
  };
}
