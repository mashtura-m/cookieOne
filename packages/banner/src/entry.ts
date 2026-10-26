import { init } from './cmp';

// cmp.js is served with `window.__CF_CONFIG__ = {...}` prepended by the API, so everything below
// runs synchronously while the <head> is still being parsed.
const script = document.currentScript as HTMLScriptElement | null;
const cfg = window.__CF_CONFIG__;
if (!cfg) {
  console.warn('[ConsentFlow] No configuration found. Load the script from /v1/cmp/<domain-key>/cmp.js.');
} else if (window.ConsentFlow && !cfg.preview) {
  console.warn('[ConsentFlow] Script loaded twice; ignoring the second copy.');
} else {
  init(cfg, { lang: script?.getAttribute('data-lang') });
}
