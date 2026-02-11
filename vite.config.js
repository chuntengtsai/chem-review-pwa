import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt', 'pwa-icon.svg', 'pwa-192.png', 'pwa-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: '高一化學覆習（診斷 → 補洞）',
        short_name: '化學覆習',
        description: '高二學生用 PWA 覆習高一化學：診斷測驗、個人化補洞路徑、錯題回收與回測。',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            // Keep the SVG as an optional high-quality source for browsers that support it.
            src: '/pwa-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,txt}']
      },
      devOptions: {
        enabled: true
      }
    })
  ]
});
