import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/**
 * The browser only talks to this origin; /api/v1 is proxied to the Express API so the refresh-token
 * cookie stays first-party (SameSite=Strict). In production the same rule lives in the reverse proxy.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_URL || 'http://localhost:4100';
  const proxy = { '/api/v1': { target: apiTarget, changeOrigin: false } };
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Camera and geolocation are needed by the field-inspection screens (same origin only).
    'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    // Port 3100 is in the API's CORS / CSRF origin allowlist (the CA Ecosystem uses 3000).
    server: { port: 3100, strictPort: true, proxy, headers: securityHeaders },
    preview: { port: 3100, strictPort: true, proxy, headers: securityHeaders },
    build: {
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        output: {
          // Long-term-cacheable vendor chunks; pages are split per route via React.lazy.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router'],
            query: ['@tanstack/react-query', 'axios'],
            ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-alert-dialog', '@radix-ui/react-tabs', 'lucide-react', 'sonner'],
            forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          },
        },
      },
    },
  };
});
