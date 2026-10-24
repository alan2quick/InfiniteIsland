// Optional account and personal-character menu. Mounting never signs in or interrupts guest play.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createProfileStore, personalCharacter, personalSave, parsePersonalSave } from './model.js';
import './profiles.css';
let protectDismissed = false;

function download(value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(personalSave(value), null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'island-character.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Profiles({ client, getCharacter, setCharacter, onRestoreSave, close }) {
  const [character, setDraft] = useState(() => personalCharacter(getCharacter()));
  const [rows, setRows] = useState([]), [selected, setSelected] = useState(null);
  const [user, setUser] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [showProtect, setShowProtect] = useState(false);
  const dialog = useRef(null), store = useRef(createProfileStore(client)).current, alive = useRef(true);
  const reminderShown = useRef(false), authOwner = useRef(null);
  useEffect(() => {
    alive.current = true;
    const prior = document.activeElement; dialog.current?.querySelector('input,button')?.focus();
    let subscription;
    if (client) {
      client.auth.getSession().then(({ data }) => { if (alive.current) { authOwner.current = data?.session?.user?.id || null; setUser(data?.session?.user || null); } });
      subscription = client.auth.onAuthStateChange((_event, session) => { if (alive.current) { const id = session?.user?.id || null; if (authOwner.current !== id) { setSelected(null); setRows([]); authOwner.current = id; } setUser(session?.user || null); } }).data.subscription;
    }
    return () => { alive.current = false; subscription?.unsubscribe(); if (prior?.isConnected) prior.focus(); };
  }, [client]);
  useEffect(() => { let cancelled = false; store.list().then((data) => { if (alive.current && !cancelled) setRows(data); }).catch((error) => { if (alive.current && !cancelled) setMessage(error.message || 'Could not load your saved characters.'); }); return () => { cancelled = true; }; }, [store, user?.id]);
  async function run(action) {
    if (busy) return; setBusy(true); setMessage('');
    try { await action(); } catch (error) { if (alive.current) setMessage(error.message || 'That did not complete. Your local character is unchanged.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function save(copy = false) {
    const value = personalCharacter(character);
    // Local appearance stays useful even when the remote operation fails.
    setCharacter(value); setDraft(value);
    if (!client) { download(value); setMessage('Downloaded your character appearance. Cloud saving is not configured.'); return; }
    let result;
    try { result = await store.save(value, copy ? null : selected); }
    catch (error) {
      if (error.message?.startsWith('Guest cloud saving is unavailable')) {
        download(value); setMessage('Guest cloud saving is unavailable. Downloaded a character copy instead. You can keep playing.'); return;
      }
      throw error;
    }
    if (!alive.current) return;
    setSelected(result.character.id); setUser(result.user); setRows(await store.list());
    setMessage('Your character appearance is saved. Shared world progress stays with the game host.');
    if (result.user.is_anonymous && !reminderShown.current) {
      let dismissed = protectDismissed; try { dismissed = dismissed || sessionStorage.getItem('island-character-protect-later') === '1'; } catch {}
      if (!dismissed) { reminderShown.current = true; setShowProtect(true); }
    }
  }
  const later = () => { protectDismissed = true; setShowProtect(false); try { sessionStorage.setItem('island-character-protect-later', '1'); } catch {} };
  const choose = (row) => {
    const value = personalCharacter(row); setDraft(value); setSelected(row.id);
    setCharacter(value); onRestoreSave?.(personalSave(value)); setMessage('Character appearance selected. Shared world progress was not changed.');
  };
  const keyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  return <section className="cg-profiles-overlay" onKeyDown={keyDown} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-modal="false" aria-labelledby="cg-profiles-title">
    <div className="cg-profiles-panel" ref={dialog}>
      <header><div><h1 id="cg-profiles-title">My character</h1><p>Save your name and look. Keep playing without an account.</p></div><button aria-label="Close character account" onClick={close}>×</button></header>
      <label>Character name<input value={character.display_name} maxLength={32} onChange={(e) => setDraft({ ...character, display_name: e.target.value })} /></label>
      <p className="cg-profiles-detail">Current look: {character.variant === 'original' ? 'Sprout' : character.variant}. All characters have the same abilities.</p>
      <div className="cg-profiles-actions"><button disabled={busy} onClick={() => run(() => save())}>{selected ? 'Update this character' : 'Save my character'}</button>{selected && <button disabled={busy} onClick={() => run(() => save(true))}>Save a new character</button>}<button onClick={() => { download(character); setMessage('Downloaded a copy of your character appearance.'); }}>Download copy</button></div>
      <label className="cg-profiles-import">Import character copy<input type="file" accept="application/json,.json" onChange={(e) => { const file = e.target.files?.[0]; if (file) run(async () => { if (file.size > 4096) throw new Error('Choose a small character backup file.'); const value = parsePersonalSave(await file.text()); choose(value.character); setSelected(null); }); e.target.value = ''; }} /></label>
      {showProtect && <aside className="cg-profiles-nudge"><strong>Keep your character for next time</strong><p>Your guest save depends on this browser session. Add an email to keep access if you clear browser data or switch devices.</p><button onClick={() => { setShowProtect(false); dialog.current?.querySelector('input[type=email]')?.focus(); }}>Protect my character</button><button onClick={later}>Later</button></aside>}
      {rows.length > 0 && <section><h2>Your saved characters</h2><div className="cg-profiles-list">{rows.map((row) => <button disabled={busy} key={row.id} aria-pressed={selected === row.id} onClick={() => choose(row)}><strong>{row.display_name}</strong><span>{row.variant === 'original' ? 'Sprout' : row.variant}</span></button>)}</div></section>}
      {client && <section><h2>{user && !user.is_anonymous ? 'Your account' : 'Keep access across devices'}</h2>
        <p className="cg-profiles-detail">{user?.email_confirmed_at ? 'Your email is verified. You can set a password below.' : 'First verify your email, then set a password. You can return to playing at any time.'}</p>
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { const result = await store.linkEmail(email); setMessage(result.alreadyVerified ? 'Email already verified. Set your password below.' : 'Verification requested. Check your email, follow the link, then return here to set a password. If no message arrives, try again later or use a downloaded copy.'); }); }}>
          <label>Email<input type="email" value={email} autoComplete="email" required onChange={(e) => setEmail(e.target.value)} /></label>
          <button disabled={busy || !!user?.email_confirmed_at}>Send verification email</button>
        </form>
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await store.setPassword(password); setPassword(''); setMessage('Password saved. Sign in with your verified email on another device to access your characters.'); }); }}>
          <label>Password<input type="password" value={password} minLength={8} autoComplete="new-password" required onChange={(e) => setPassword(e.target.value)} /></label>
          <button disabled={busy || !user?.email_confirmed_at}>Set password after verification</button>
        </form>
        <details><summary>Already have an account?</summary><p className="cg-profiles-detail">Signing in does not transfer guest cloud characters. Download a copy before switching accounts.</p>
          <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fields = new FormData(form); run(async () => { const { error } = await client.auth.signInWithPassword({ email: String(fields.get('email')).trim(), password: String(fields.get('password')) }); form.reset(); if (error) throw error; setSelected(null); setRows(await store.list()); setMessage('Signed in. Choose one of your saved characters, or save your current appearance.'); }); }}>
            <label>Email<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button disabled={busy}>Sign in</button>
          </form>
        </details>
      </section>}
      <p className="cg-profiles-message" role="status">{busy ? 'Saving changes…' : message}</p>
      <footer><button onClick={close}>Back to the island</button></footer>
    </div>
  </section>;
}

export function mountProfiles({ cloud, getCharacter = () => ({}), setCharacter = () => {}, getSave, onRestoreSave, onOpen = () => {}, onClose = () => {} } = {}) {
  // getSave is intentionally NOT serialized: the host's shared game save must never become a personal character save.
  void getSave;
  let host = null, root = null;
  const close = () => { if (!root) return; root.unmount(); host.remove(); root = host = null; onClose(); };
  return {
    open() { if (root) return; onOpen(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); root.render(<Profiles client={cloud?.client || null} getCharacter={getCharacter} setCharacter={setCharacter} onRestoreSave={onRestoreSave} close={close} />); },
    close, unmount: close, get isOpen() { return !!root; },
  };
}
