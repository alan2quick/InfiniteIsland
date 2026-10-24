// Adapts serializable world preferences to existing systems. Preview never owns gameplay or player saves.
import { DayNight } from '../world/dayNight.js';
import * as wind from '../world/wind.js';
import { DEFAULT_WORLD_SETTINGS, SETTING_RULES } from './worldSettings.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function safeSettings(input = {}) {
  const out = { ...DEFAULT_WORLD_SETTINGS };
  for (const [key, [min, max]] of Object.entries(SETTING_RULES))
    if (Number.isFinite(input[key])) out[key] = clamp(input[key], min, max);
  for (const key of ['dayCycle', 'intro']) if (typeof input[key] === 'boolean') out[key] = input[key];
  if (['original', 'follow'].includes(input.cameraMode)) out.cameraMode = input.cameraMode;
  return out;
}

export function createEnvironmentBridge({ renderer, scene, sky, dayNight, props, water, ambient, music, ambienceAudio, followCam, keyboard, sync } = {}) {
  let settings = { ...DEFAULT_WORLD_SETTINGS }, previewClock = null, previewTimeKey = null, publishedTimeKey = null;
  let receivedPublishedRevision = false;
  let comparisonOpen = false;
  let open = false, viewport = 'desktop', frame = null, content = null, placeholders = [];
  let lastExposure = null, lastFog = null;

  function size() {
    const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const h = typeof window === 'undefined' ? 720 : window.innerHeight;
    if (!open) return { width: w, height: h, touch: null };
    const roomW = Math.max(160, w - (w >= 700 ? 386 : 24)), roomH = Math.max(160, h - 24);
    if (viewport === 'mobile-portrait') return { width: 390, height: 844, touch: true, roomW, roomH };
    if (viewport === 'mobile-landscape') return { width: 844, height: 390, touch: true, roomW, roomH };
    return { width: roomW, height: roomH, touch: false, roomW, roomH };
  }
  function arrangeFrame() {
    const box = size();
    if (!frame || !content) return box;
    const scale = Math.min(1, box.roomW / box.width, box.roomH / box.height);
    Object.assign(frame.style, { width: `${box.width * scale}px`, height: `${box.height * scale}px`, left: `${12 + Math.max(0, (box.roomW - box.width * scale) / 2)}px`, top: `${12 + Math.max(0, (box.roomH - box.height * scale) / 2)}px` });
    Object.assign(content.style, { width: `${box.width}px`, height: `${box.height}px`, transform: `scale(${scale})` });
    frame.dataset.mode = viewport;
    return box;
  }
  function mountFrame() {
    if (typeof document === 'undefined' || frame) return;
    const nodes = ['app', 'hud'].map((id) => document.getElementById(id)).filter(Boolean);
    if (!nodes.length) return;
    frame = document.createElement('div'); frame.id = 'world-editor-preview';
    content = document.createElement('div'); content.className = 'world-editor-preview-content';
    // A transformed ancestor makes existing fixed HUD widgets relative to this frame.
    Object.assign(frame.style, { position: 'fixed', overflow: 'hidden', borderRadius: '16px', zIndex: '0', background: '#211d2c', boxShadow: '0 0 0 3px #2b2340' });
    Object.assign(content.style, { position: 'relative', transformOrigin: 'top left' });
    frame.appendChild(content); document.body.appendChild(frame);
    for (const node of nodes) {
      const placeholder = document.createComment(`editor-${node.id}`);
      node.parentNode.insertBefore(placeholder, node); placeholders.push([placeholder, node]); content.appendChild(node);
    }
    arrangeFrame();
    if (comparisonOpen) frame.style.visibility = 'hidden';
  }
  function unmountFrame() {
    for (const [placeholder, node] of placeholders) placeholder.replaceWith(node);
    placeholders = []; frame?.remove(); frame = content = null;
  }
  function resize() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize')); }

  const api = {
    getCapabilities() {
      const camera = typeof followCam?.setSettings === 'function';
      return { hour: !!dayNight, dayCycle: !!dayNight, brightness: !!renderer, haze: !!scene?.fog,
        breeze: typeof wind.setWindStrength === 'function', water: typeof water?.setMotion === 'function',
        butterflies: typeof ambient?.setButterflyMotion === 'function', musicTempo: typeof music?.setBaseTempo === 'function',
        musicVolume: typeof music?.setVolume === 'function', natureVolume: typeof ambienceAudio?.setVolume === 'function',
        cameraMode: camera, cameraAngle: camera, cameraDistance: camera, cameraSmoothness: camera, intro: typeof followCam?.startIntro === 'function' };
    },
    apply(input, { preview = false } = {}) {
      settings = safeSettings(input);
      if (preview) {
        const key = `${settings.hour}:${settings.dayCycle}`;
        if (!previewClock) previewClock = new DayNight({ persist: false, params: new URLSearchParams({ time: String(settings.hour) }) });
        if (previewTimeKey !== key) { previewClock.locked = !settings.dayCycle; previewClock.set(settings.hour); previewTimeKey = key; }
      } else { previewClock = null; previewTimeKey = null; }
      wind.setWindStrength?.(settings.breeze);
      water?.setMotion?.(settings.water); ambient?.setButterflyMotion?.(settings.butterflies);
      music?.setBaseTempo?.(settings.musicTempo); music?.setVolume?.(settings.musicVolume); ambienceAudio?.setVolume?.(settings.natureVolume);
      followCam?.setSettings?.({ mode: settings.cameraMode, angle: settings.cameraAngle, distance: settings.cameraDistance, smoothness: settings.cameraSmoothness, intro: settings.intro });
      return { ...settings };
    },
    // Call once when accepting PUBLISHED settings, never for a slider draft. Local previews use an isolated clock.
    applyPublishedTime(input, { revision } = {}) {
      if (!dayNight || (sync && !sync.isHost)) return false;
      const next = safeSettings(input), key = `${next.hour}:${next.dayCycle}`;
      if (Number.isSafeInteger(revision) && revision >= 0) {
        const first = !receivedPublishedRevision;
        receivedPublishedRevision = true;
        // Revision zero is the database seed, not an admin's time change.
        // Loading it must preserve an existing host's saved hour/clock lock.
        if (first && revision === 0) { publishedTimeKey = key; return false; }
      }
      if (key === publishedTimeKey) return false;
      publishedTimeKey = key;
      dayNight.locked = !next.dayCycle;
      dayNight.set(next.hour);
      return true;
    },
    beforeFrame(dt = 0) {
      // Restore the previous cosmetic multiplier before the game's own lighting resets/overrides.
      if (renderer && lastExposure?.result === renderer.toneMappingExposure) renderer.toneMappingExposure = lastExposure.base;
      if (scene?.fog && lastFog?.fog === scene.fog && lastFog.near === scene.fog.near && lastFog.far === scene.fog.far) {
        scene.fog.near = lastFog.baseNear; scene.fog.far = lastFog.baseFar;
      }
      lastExposure = lastFog = null;
      if (previewClock) previewClock.update(dt);
      const visualClock = previewClock || dayNight;
      if (visualClock) { ambient?.setClock?.(visualClock); if (ambienceAudio) ambienceAudio.clock = visualClock; }
      // Main owns camera subject/context after input claims are polled. Never activate a camera here:
      // local player count omits remote players and this bridge does not know about special scenes.
      if (open) keyboard?.releaseAll?.();
      return previewClock || dayNight;
    },
    get clock() { return previewClock || dayNight; },
    // Main applies the returned visual clock through sky/water BEFORE regional/party/dungeon lighting.
    // Then call this after those lighting systems; it must not replace their camera or palette.
    afterLighting() {
      if (renderer) {
        const exposure = renderer.toneMappingExposure;
        // Remain idempotent if a caller reapplies without the normal lighting reset between calls.
        const base = lastExposure?.result === exposure ? lastExposure.base : exposure;
        if (Number.isFinite(base)) {
          renderer.toneMappingExposure = clamp(base * settings.brightness, 0.1, 3);
          lastExposure = { base, result: renderer.toneMappingExposure };
        }
      }
      const fog = scene?.fog;
      if (fog && Number.isFinite(fog.near) && Number.isFinite(fog.far)) {
        const unchanged = lastFog?.fog === fog && lastFog.near === fog.near && lastFog.far === fog.far;
        const near = unchanged ? lastFog.baseNear : fog.near, far = unchanged ? lastFog.baseFar : fog.far;
        const factor = 1 + (settings.haze - 0.25) * 0.9;
        fog.near = Math.max(1, near / factor); fog.far = Math.max(fog.near + 10, far / factor);
        lastFog = { fog, near: fog.near, far: fog.far, baseNear: near, baseFar: far };
      }
    },
    setEditorOpen(value) {
      const next = !!value;
      if (next === open) return;
      open = next; keyboard?.releaseAll?.();
      if (open) mountFrame(); else unmountFrame();
      resize();
    },
    get isOpen() { return open; },
    setComparisonOpen(value) { comparisonOpen = !!value; keyboard?.releaseAll?.(); if (frame) frame.style.visibility = comparisonOpen ? 'hidden' : ''; },
    get comparisonOpen() { return comparisonOpen; },
    setViewport(mode) {
      viewport = ['desktop', 'mobile-portrait', 'mobile-landscape'].includes(mode) ? mode : 'desktop';
      arrangeFrame(); resize();
    },
    getViewportSize() { const { width, height, touch } = arrangeFrame(); return { width, height, touch }; },
    dispose() { comparisonOpen = false; open = false; unmountFrame(); previewClock = null; resize(); },
  };
  return api;
}
