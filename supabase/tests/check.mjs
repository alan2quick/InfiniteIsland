// Optional embedded Postgres verifier. It uses no cloud account or credentials.
// Install PGlite separately, then set PGLITE_MODULE to its absolute module URL/path.
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { DEFAULT_WORLD_SETTINGS, SETTING_RULES } from '../../public/js/settings/worldSettings.js';

let moduleName = process.env.PGLITE_MODULE || '@electric-sql/pglite';
if (moduleName.startsWith('/')) moduleName = pathToFileURL(moduleName).href;
const { PGlite } = await import(moduleName);
const db = new PGlite();
try {
  // Stand-ins model the identity/role interface supplied by Supabase Auth.
  // They do not test Auth's token validation, HTTP API, or Realtime transport.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  const seeded = await db.query("select settings from public.world_settings where id = 'default'");
  assert.deepEqual(seeded.rows[0].settings, DEFAULT_WORLD_SETTINGS, 'database defaults match browser defaults');
  // Exercise shared range boundaries against the SQL validator, not just its text.
  let validationCases = 0;
  const validate = settings => db.query('select island_private.validate_world_settings($1::jsonb)', [JSON.stringify(settings)]);
  for (const [key, [low, high]] of Object.entries(SETTING_RULES)) {
    for (const value of [low, high]) { await validate({ ...DEFAULT_WORLD_SETTINGS, [key]: value }); validationCases++; }
    for (const value of [low - 0.001, high + 0.001, String(low), null]) {
      await assert.rejects(validate({ ...DEFAULT_WORLD_SETTINGS, [key]: value }), error => error.code === '22023'); validationCases++;
    }
  }
  for (const key of Object.keys(DEFAULT_WORLD_SETTINGS)) {
    const missing = { ...DEFAULT_WORLD_SETTINGS }; delete missing[key];
    await assert.rejects(validate(missing), error => error.code === '22023'); validationCases++;
  }
  console.log(`PASS: browser/SQL defaults agree; ${validationCases} range/type/completeness cases`);
  await db.exec(readFileSync(new URL('./security.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('./releases.sql', import.meta.url), 'utf8'));
  const { rows } = await db.query(`select tablename from pg_tables
    where schemaname = 'public' and not rowsecurity`);
  if (rows.length) throw new Error('Public table without RLS');
  console.log('PASS: migrations execute; database roles, RLS, validation, revision history, conflict handling, and owner isolation');
  console.log('Supabase Auth, API, Realtime, advisors, and simultaneous-session locking still need local-stack or cloud verification.');
} finally {
  await db.close();
}
