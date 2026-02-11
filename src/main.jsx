import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App.jsx';

// PWA: auto update service worker when a new version is available.
// Also surface a small UI hint when a refresh is needed.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    try {
      window.dispatchEvent(new CustomEvent('pwa:need-refresh', { detail: { updateSW } }));
    } catch {
      // ignore
    }
  },
  onOfflineReady() {
    try {
      window.dispatchEvent(new CustomEvent('pwa:offline-ready'));
    } catch {
      // ignore
    }
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
