// Optional world administration; independent of character, camera and presentation additions.
import { createAdminTools, initializeExplorationSandbox, isExplorationSandbox } from './adminTools.js';
import { isEditorPreview, mountPreviewReceiver } from './previewRuntime.js';
import { createSettingsStore } from './worldSettings.js';
import { createEnvironmentBridge } from './environmentBridge.js';

function style(name) {
  if (document.querySelector(`link[data-island-style="${name}"]`)) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `/generated/${name}.css`; link.dataset.islandStyle = name; document.head.append(link);
}
export async function mountExtensions(game) {
  const bridge = createEnvironmentBridge(game), adminTools = createAdminTools(game);
  let config = {}, cloud = { configured: false };
  if (!isEditorPreview) try {
    const response = await fetch('/generated/config.json', { cache: 'no-store' });
    if (response.ok) config = await response.json();
  } catch { /* The original game remains playable offline. */ }
  if (config.supabaseUrl && config.supabasePublishableKey) try {
    const { createCloud } = await import('/generated/cloud.js'); cloud = createCloud(config);
  } catch { /* Local preview and export still work. */ }
  let storage = null; try { if (!isEditorPreview) storage = localStorage; } catch { /* Storage may be blocked. */ }
  const settingsStore = createSettingsStore({ cloud, storage, apply: (settings, meta) => {
    bridge.apply(settings, meta);
    if (!meta.preview && Number.isInteger(meta.revision)) bridge.applyPublishedTime(settings, { revision: meta.revision });
  } });
  const editor = { bridge, settingsStore, cloud, adminTools, get isOpen() { return bridge.isOpen; } };
  game.editor = editor;
  let admin = null, refreshTimer = null;
  const params = new URLSearchParams(location.search);
  if ((!isEditorPreview || isExplorationSandbox) && (params.has('admin') || location.pathname === '/editor')) {
    style('admin');
    try { const { mountAdmin } = await import('/generated/admin.js'); admin = mountAdmin({ bridge, settingsStore, cloud, adminTools }); }
    catch { game.hud.toast('World editor could not load. The game is still available.', { duration: 4000 }); }
  }
  const refresh = () => { if (!document.hidden) settingsStore.refresh(); };
  if (!isEditorPreview) {
    settingsStore.start(); document.addEventListener('visibilitychange', refresh);
    refreshTimer = setInterval(refresh, 60000);
  }
  const stopPreview = isEditorPreview ? mountPreviewReceiver({ apply: (settings) => bridge.apply(settings, { preview: true }) }) : () => {};
  if (isEditorPreview) game.title?.dismiss();
  try { initializeExplorationSandbox(game); }
  catch (error) { game.hud.toast(error.message, { duration: 4000 }); }
  editor.dispose = () => { stopPreview(); clearInterval(refreshTimer); document.removeEventListener('visibilitychange', refresh); admin?.unmount(); bridge.dispose(); };
  return editor;
}
