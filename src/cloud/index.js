import { createClient } from '@supabase/supabase-js';

export function createCloud(config = {}) {
  if (!config.supabaseUrl || !config.supabasePublishableKey) return { configured: false };
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { storageKey: 'infiniteIsland.auth.v1' } });
  const checked = ({ data, error }) => { if (error) throw error; return data; };
  return {
    configured: true, client,
    async readPublishedReleases() { return checked(await client.from('published_releases').select('version,title,changes,note,noteworthy,commit_sha,deployment_url,github_url,deployed_at,published_at').order('published_at', { ascending: false }).limit(20)); },
    async load() { return checked(await client.from('world_settings').select('settings,revision').eq('id', 'default').single()); },
    async publish(settings, revision) { const data = checked(await client.rpc('publish_world_settings', { new_settings: settings, expected_revision: revision })); return Array.isArray(data) ? data[0] : data; },
    async previous(revision) { return checked(await client.from('world_setting_revisions').select('settings,revision').eq('world_id', 'default').lt('revision', revision).order('revision', { ascending: false }).limit(1).maybeSingle()); },
    async isAdmin(id) { return !!checked(await client.from('world_admins').select('user_id').eq('user_id', id).maybeSingle()); },
    async signIn(email, password) { return checked(await client.auth.signInWithPassword({ email, password })); },
    async signOut() { checked(await client.auth.signOut()); },
    onAuth(fn) {
      client.auth.getSession().then(({ data }) => fn(data.session?.user || null));
      // Avoid awaiting another auth call inside Supabase's auth callback.
      return client.auth.onAuthStateChange((_event, session) => { setTimeout(() => fn(session?.user || null), 0); });
    },
    onSettings(fn) {
      const channel = client.channel('published-world-settings').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'world_settings', filter: 'id=eq.default' }, (payload) => fn(payload.new)).subscribe((status) => {
        if (status === 'SUBSCRIBED') client.from('world_settings').select('settings,revision').eq('id', 'default').single().then(({ data, error }) => { if (!error && data) fn(data); });
      });
      return () => client.removeChannel(channel);
    },
  };
}
