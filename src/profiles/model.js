// Personal appearance only. Shared inventories, quests, world state and arbitrary JSON are never uploaded/restored here.
import { normaliseAppearance } from './appearance.js';
const IDS = new Set(['original', 'rowan', 'pip', 'marlow', 'clover', 'sunny']);
export function personalCharacter(value = {}) {
  const display_name = typeof value.display_name === 'string' ? [...value.display_name.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 32).join('') : '';
  const appearance = normaliseAppearance(value.appearance);
  return { variant: IDS.has(value.variant) ? value.variant : 'original', display_name: display_name || 'Island friend', appearance };
}
export function personalSave(value) { return { version: 1, character: personalCharacter(value) }; }
export function parsePersonalSave(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('Choose a small character backup file.');
  const value = JSON.parse(text);
  if (value?.version !== 1 || !value.character || typeof value.character !== 'object') throw new Error('This is not a character appearance backup.');
  return personalSave(value.character);
}

export function createProfileStore(client) {
  async function owner({ create = false } = {}) {
    if (!client) throw new Error('Cloud character saving is not configured. Download a character copy instead.');
    let { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session && create) {
      ({ data, error } = await client.auth.signInAnonymously());
      if (error) throw new Error('Guest cloud saving is unavailable. Download a copy, or sign in to an existing account.');
    }
    if (!data.session && !data.user) return null;
    const verified = await client.auth.getUser();
    if (verified.error) throw verified.error;
    if (!verified.data.user) throw new Error('Please sign in again before saving.');
    return verified.data.user;
  }
  return {
    async list() {
      const user = await owner(); if (!user) return [];
      const { data, error } = await client.from('player_characters').select('id,owner_id,display_name,variant,appearance,updated_at').eq('owner_id', user.id).order('updated_at', { ascending: false }).limit(30);
      if (error) throw error;
      // Ownership is enforced by RLS; this additional filter avoids displaying malformed responses.
      return (data || []).filter((row) => row.owner_id === user.id).map((row) => ({ id: row.id, ...personalCharacter(row) }));
    },
    async save(value, id = null) {
      const user = await owner({ create: true });
      const character = personalCharacter(value);
      const payload = { ...character, owner_id: user.id, save_data: personalSave(character), updated_at: new Date().toISOString() };
      const query = id ? client.from('player_characters').update(payload).eq('id', id).eq('owner_id', user.id) : client.from('player_characters').insert(payload);
      const { data, error } = await query.select('id,owner_id,display_name,variant,appearance').single();
      if (error) throw error;
      if (data?.owner_id !== user.id) throw new Error('Character ownership could not be verified.');
      return { user, character: { id: data.id, ...personalCharacter(data) } };
    },
    async linkEmail(email) {
      const user = await owner({ create: true });
      if (!user.is_anonymous && user.email_confirmed_at) return { alreadyVerified: true };
      const { error } = await client.auth.updateUser({ email: email.trim() });
      if (error) throw error;
      return { alreadyVerified: false };
    },
    async setPassword(password) {
      const user = await owner();
      if (!user?.email_confirmed_at) throw new Error('Verify your email first, then return here to set your password.');
      if (typeof password !== 'string' || password.length < 8) throw new Error('Use at least 8 characters for your password.');
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
    },
  };
}
