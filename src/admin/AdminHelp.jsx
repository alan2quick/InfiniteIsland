import React, { useState } from 'react';

const DESTINATIONS = [['home', 'Home camp'], ['frost', 'Frostpine'], ['ember', 'Emberleaf'], ['duskLanding', 'Duskcrown beach']];
export function AdminHelp({ tools, comparing = false }) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(fn) {
    if (busy) return;
    setBusy(true); setFeedback('');
    try { const result = await fn(); setFeedback(typeof result === 'string' ? result : 'Done.'); }
    catch (error) { setFeedback(error?.message || 'This action is unavailable right now.'); }
    finally { setBusy(false); }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setFeedback('Command copied. Paste it into the game tab’s browser console.'); }
    catch { setFeedback('Clipboard unavailable. Select and copy the command shown below.'); }
  }
  return <details className="island-editor-section island-admin-help">
    <summary>Help & testing</summary>
    <h3>Getting around</h3>
    <p>Use WASD to move, E to interact, and Space to jump. On a phone, use the joystick and action buttons. Open the game’s gear → How to play for the full controls.</p>
    <p>Collapse the editor before walking. Sliders are private previews; Publish saves shared environment settings when you are signed in as an admin.</p>
    <h3>Quick travel</h3>
    <p>Move your character to an island landing in a solo host game. Finish any open dialog or activity first. These shortcuts do not complete quests.</p>
    {comparing && <p>Choose a single preview before using quick travel.</p>}
    <div className="island-admin-travel">{DESTINATIONS.map(([id, label]) => <button type="button" key={id} disabled={!tools || busy || comparing} onClick={() => act(() => tools.travel(id))}>{label}</button>)}</div>
    <h3>Console commands</h3>
    <p>In Chrome, open View → Developer → JavaScript Console. Select the main game page as the console context. Run only commands you understand.</p>
    {DESTINATIONS.map(([id, label]) => {
      const command = `__game.editor.adminTools.travel('${id}')`;
      return <div className="island-admin-command" key={id}><span>{label}</span><code>{command}</code><button type="button" onClick={() => copy(command)} aria-label={`Copy ${label} command`}>Copy</button></div>;
    })}
    <p>For another shortcut, ask: “What console command teleports me to the waterfall?” or “How can I inspect which cosmetics are unlocked?” Include the destination or item name and whether you want a temporary preview or a saved change.</p>
    <h3>Unlock for testing</h3>
    <p className="island-admin-unlock-description">{tools?.unlockDescription || 'Loading available unlock actions…'}</p>
    <button type="button" className="island-admin-unlock" disabled={!tools || busy || comparing} onClick={() => act(() => tools.unlockAll())}>Unlock everything for testing</button>
    <p role="status" className="island-editor-hint">{feedback}</p>
  </details>;
}
