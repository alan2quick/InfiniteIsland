// This module must be the first main dependency: isolate child storage before game constructors run.
import { validateSettings } from './worldSettings.js';
export const isEditorPreview = new URLSearchParams(globalThis.location?.search || '').get('editorPreview') === '1';

export function createMemoryStorage() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(String(key)) ?? null; },
    setItem(key, value) { entries.set(String(key), String(value)); },
    removeItem(key) { entries.delete(String(key)); }, clear() { entries.clear(); },
  };
}
export function installPreviewIsolation(target) {
  // Never touch Storage.prototype: that would affect the parent's real game.
  for (const key of ['localStorage', 'sessionStorage']) {
    const storage = createMemoryStorage();
    Object.defineProperty(target, key, { configurable: true, value: storage });
    if (target[key] !== storage) throw new Error('Preview storage isolation unavailable.');
  }
  target.localStorage.setItem('infiniteIsland.muted', '1');
}
if (isEditorPreview && typeof window !== 'undefined') installPreviewIsolation(window);

export function createPreviewLink() {
  return { code: null, connected: false, controllers: new Set(), clientIds: new Map(), screens: new Set(),
    on() { return this; }, sendTo() { return false; }, sendToScreen() { return false; }, broadcastScreens() { return false; }, close() {} };
}

export function mountPreviewReceiver({ target = window, apply }) {
  const parent = target.parent, origin = target.location.origin;
  const receive = (event) => {
    if (parent === target || event.source !== parent || event.origin !== origin || event.data?.type !== 'island-editor-preview') return;
    try { apply(validateSettings(event.data.settings)); } catch { /* Malformed/untrusted messages never alter the view. */ }
  };
  target.addEventListener('message', receive);
  if (parent !== target) parent.postMessage({ type: 'island-editor-preview-ready' }, origin);
  return () => target.removeEventListener('message', receive);
}
