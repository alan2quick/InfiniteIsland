# Persistent world settings and player storage

The database migration is ready in
[`supabase/migrations/20261024163446_world_admin_settings.sql`](../supabase/migrations/20261024163446_world_admin_settings.sql).
It adds a shared environment configuration with version history, a trusted admin
membership table, and separate owner-controlled character and host-save tables.
It does not change the existing browser saves or migrate them automatically.

No cloud project is created by these files. They contain no connection passwords
or API secrets. Project setup and application deployment are separate steps.

## Free-project setup

1. In the Supabase Dashboard, create or select a dedicated **Free** project for
   this game deployment. Keep it separate from unrelated applications.
2. In SQL Editor, review and run the migration once. It is transactional, but is
   not designed to be pasted repeatedly after its tables already exist. With a
   linked CLI project, apply the committed migration through the normal migration
   workflow instead; do not also paste it into SQL Editor.
3. Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the
   build environment using the project's URL and **publishable** API key. These
   values are intentionally browser-public and are emitted into runtime config.
   A legacy `anon` key is compatible when needed. Never put a secret API key,
   `service_role` key, database password, or personal access token in browser code.
4. Enable email/password Auth for admin sign-in. Create the admin user using Auth
   in the Dashboard, or register through the application's account flow when it
   is available. Copy that user's UUID from Auth → Users.
5. Bootstrap membership through the trusted SQL Editor using the statement below.
   Ordinary clients, including signed-in admins, cannot grant themselves membership.
6. Configure Auth's Site URL and allowed redirect URLs for the deployed fork and
   local development. Add only the actual origins/paths needed by the app.
7. Verify a signed-out browser can load the current settings, an ordinary account
   cannot publish, and the designated admin can publish and see a new revision.
   Check a second browser receives the change and survives reload.

Run only in the project's trusted SQL Editor, replacing the placeholder with an
existing Auth user's UUID:

```sql
insert into public.world_admins (user_id)
values ('REPLACE_WITH_AUTH_USER_UUID'::uuid)
on conflict (user_id) do nothing;
```

To remove access, delete that UUID's membership through the same trusted console.
Publishing checks membership in the database each time, so revocation does not
wait for a token refresh. Signing into the Supabase Dashboard alone does not make
a game account an admin.

The migration explicitly grants required table/function access. This also handles
Supabase's [change to automatic API exposure](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
Keep `island_private` out of Data API exposed schemas; only `public` needs exposure.

### Baseline the manually applied migration

SQL Editor changes do not automatically create a CLI migration-history entry.
Before using the linked CLI to apply later migrations, compare the hosted tables,
constraints, functions, policies and grants with the committed migration. After
confirming they match, record the already-applied version without executing it:

```sh
supabase migration list
supabase migration repair --status applied 20261024163446
supabase migration list
```

These commands assume the CLI is linked to the intended Infinite Island project.
`repair` changes the tracking record only; it does not execute or revert SQL.
Do not mark a version applied merely because its five table names exist. If the
hosted schema differs, reconcile it first using the
[Supabase migration workflow](https://supabase.com/docs/guides/deployment/database-migrations).
Do not duplicate the original DDL or overwrite unrelated migration history.

At the time of implementation, the [Free plan](https://supabase.com/pricing)
includes 500 MB of database storage and pauses projects after a week of inactivity.
Stay on the Free organization/project tier and review usage periodically. The game
should retain its bundled/cached appearance when the backend is unavailable; no
paid plan or keep-alive service is required by this design. Use JSON exports for
additional backups rather than relying on paid backup features.

## API contract

| Resource | Purpose | Client access |
| --- | --- | --- |
| `world_settings` | Singleton `id = 'default'`, `settings`, `revision`, `updated_at`, `updated_by` | Public read; no direct client writes |
| `world_setting_revisions` | `(world_id, revision)` key; full settings snapshot and attribution | Admin history read; no direct client writes |
| `world_admins` | Auth UUID membership | Authenticated account can read only its own membership; no client writes |
| `player_characters` | UUID, owner UUID, display name, variant, appearance, character save | Owner-only read/create/update/delete |
| `world_saves` | One host-progress document per owner UUID | Owner-only read/create/update/delete |

The environment settings are public information, so they must not contain account
information, secrets, or private save data. Personal characters and host progress
are not public, including to game admins. Passwords are handled by Supabase Auth,
never stored in these tables.

Read current settings with a select filtered to `id = 'default'`. Check membership
by selecting `world_admins` for the signed-in user's UUID. UI visibility is a
convenience: the database independently authorizes every publish.

Publish through the public RPC:

```js
const { data, error } = await supabase.rpc('publish_world_settings', {
  new_settings: completeSettingsObject,
  expected_revision: lastLoadedRevision,
});
```

The RPC returns one `world_settings` row. It requires all 15 settings keys and
rejects missing keys, unknown keys, wrong types, out-of-range values, and settings
larger than 16 KiB. JSON numeric values must be finite. Supported keys:

| Key | Allowed values | Default |
| --- | --- | --- |
| `hour` | 0–24 | 8 |
| `dayCycle` | boolean | true |
| `brightness` | 0.5–1.5 | 1 |
| `haze` | 0–1 | 0.25 |
| `breeze` | 0–1 | 0.5 |
| `water` | 0–1 | 0.5 |
| `butterflies` | 0–1 | 0.3 |
| `musicTempo` | 0.5–1.5 | 0.8 |
| `musicVolume` | 0–1 | 0.3 |
| `natureVolume` | 0–1 | 1 |
| `cameraMode` | `original` or `follow` | `original` |
| `cameraAngle` | 15–70 | 45 |
| `cameraDistance` | 5–24 | 16 |
| `cameraSmoothness` | 0–1 | 0.65 |
| `intro` | boolean | true |

The public RPC is an unprivileged wrapper around a guarded `SECURITY DEFINER`
function in the private schema. The implementation uses a fixed empty search path,
a fresh Auth UUID/membership lookup, a row lock, and an expected-revision check.
Current settings and their historical snapshot update in one transaction.

SQLSTATE `42501` means no admin permission; `22023` means invalid settings;
`40001` means the current revision changed. On conflict, preserve the local draft,
reload the published row, and ask the admin to review before trying again. Do not
silently overwrite another admin's edit. To restore an older appearance, publish
that historical snapshot against the latest revision; history is not rewritten.
Revision zero contains the initial defaults. Loading this seed preserves the
host's existing saved clock; later published time/day-cycle edits still apply.

The migration adds only `world_settings` to an existing `supabase_realtime`
publication, without replacing its other members. If that publication is absent,
enable Postgres Changes for this table through the Dashboard. Subscribe to the
`public.world_settings` singleton; draft changes stay local until publish.
Realtime is for environment changes, not high-frequency gameplay packets. The
existing host-authoritative multiplayer remains responsible for gameplay.

## Guest characters and account claiming

The owner ID is the Auth UUID, not the character's name. Variants are restricted
to `original`, `rowan`, `pip`, `marlow`, `clover`, and `sunny`; display names are
1–32 trimmed characters. Appearance documents are capped at 16 KiB, character
save documents at 1 MiB, and host-progress documents at 2 MiB. These bounds limit
individual payloads rather than providing a complete anti-abuse quota system.

Guest cloud saves require [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
to be enabled in Auth. Anonymous Auth users have their own UUID and the
`authenticated` database role; an unauthenticated `anon` request cannot access
personal saves. Local play should still work without creating a cloud account.

The optional My character component requires an explicit game adapter; it is not
launched by this standalone editor. It saves personal name, variant and palette
appearance only. Shared inventory, quests and host-world progress remain with the
existing host/browser save. The `world_saves` table is reserved for a separate
future adapter; the current character menu does not use it or back up the full game.

For account claiming, enable manual identity linking. The menu links an email to
the existing anonymous user and permits password setup after email verification,
retaining the same UUID and character ownership. Signing into an already-existing
account does not transfer guest characters: the menu warns players to download a
copy first. They can then import that appearance and save a new copy in the other
account. There is no automatic merge by display name. Guest storage/session loss
can make an unclaimed character inaccessible.

Supabase's [default SMTP service](https://supabase.com/docs/guides/auth/auth-smtp)
only sends to pre-authorized project-team addresses and has strict rate limits.
Do not promise public email confirmations or password recovery until an appropriate
SMTP provider is configured and tested. Admin accounts can be created through the
trusted Dashboard for initial setup. Select a provider's free tier if desired;
this migration does not enable any paid service or disable email confirmation.

## Verification

The migration and `supabase/tests/security.sql` were executed successfully on
embedded PostgreSQL using PGlite with stand-ins for Supabase's Auth identity
interface. The repeatable verifier also checks browser/SQL default agreement and
87 numeric boundary, type, and required-key cases. Checks include public/private
access, owner isolation, forbidden direct
writes, valid publish, invalid payloads, history, stale revisions, immediate admin
revocation, and character constraints. This is actual SQL execution, not just a
text scan. This independent change does not configure a hosted project or certify
your deployment. Docker is optional for the embedded verifier; a full local
Supabase stack is a separate check. End-to-end hosted
Auth/API/Realtime, advisor review and simultaneous-session lock testing are
separate release checks; local SQL success alone does not establish those results.
Stale-revision rejection is covered locally.

For an isolated repeat without a Docker daemon, install the optional test runtime
outside the repo and run:

```sh
npm install --prefix /tmp/infinite-island-sql-check --no-audit --no-fund @electric-sql/pglite@0.5.11
PGLITE_MODULE=/tmp/infinite-island-sql-check/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/check.mjs
```

For a disposable local Supabase database, apply the migration and run the SQL test
file with `psql`, using the local connection settings provided by that stack:

```sh
psql --set=ON_ERROR_STOP=1 --file=supabase/tests/security.sql
```

The SQL test runs in a transaction and rolls its fixtures back. It is not a pgTAP
file and should not be passed to `pg_prove`. Run it against a disposable database,
then run Supabase security/performance advisors and an end-to-end two-browser test
before claiming the hosted integration is verified.


### Hosted release-history verification (2026-10-24)

The existing release-history SQL was applied to the Infinite Island project through the connector as ledger entry `20261024181636_published_releases`. Its source is the local `20261024171248_published_releases.sql`; these timestamps differ, so reconcile migration history before a future CLI push rather than replaying the same CREATE statements. New installations should apply the local migrations normally. Hosted checks confirmed RLS, anonymous/authenticated read-only grants, and an empty announcement table. No release has been announced by this migration.

The security advisor also reported an existing `public.rls_auto_enable()` security-definer function executable by public API roles. This was not introduced or modified by the release-history migration and remains a follow-up; the advisor result is not a clean security certification.
