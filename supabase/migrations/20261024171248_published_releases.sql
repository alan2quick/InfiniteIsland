-- Public product notes only. Browser users (including world admins) cannot announce deployments.
begin;
create function island_private.valid_release_changes(value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when pg_catalog.jsonb_typeof(value) = 'array' then
    pg_catalog.jsonb_array_length(value) between 1 and 20
    and pg_catalog.octet_length(value::text) <= 16384
    and not exists (select 1 from pg_catalog.jsonb_array_elements(value) as elements(item)
      where pg_catalog.jsonb_typeof(item) <> 'string'
        or pg_catalog.length(pg_catalog.btrim(item #>> '{}')) not between 1 and 500)
  else false end
$$;
revoke all on function island_private.valid_release_changes(jsonb) from public, anon, authenticated;
grant usage on schema island_private to service_role;
grant execute on function island_private.valid_release_changes(jsonb) to service_role;

create table public.published_releases (
  version text primary key check (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[a-zA-Z0-9.-]+)?$' and length(version) <= 60),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  title text not null check (length(btrim(title)) between 1 and 120),
  changes jsonb not null check (island_private.valid_release_changes(changes)),
  note text not null default '' check (length(note) <= 1024),
  noteworthy boolean not null default false,
  github_url text not null check (github_url = 'https://github.com/Stephenitis/InfiniteIsland/releases/tag/v' || version),
  deployment_url text not null check (deployment_url ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$' and length(deployment_url) <= 255),
  deployed_at timestamptz not null,
  published_at timestamptz not null default now()
);
alter table public.published_releases enable row level security;
revoke all on public.published_releases from public, anon, authenticated, service_role;
grant select on public.published_releases to anon, authenticated;
-- Trusted server credentials bypass RLS. Explicit limited grants also support projects with API auto-exposure disabled.
grant select, insert on public.published_releases to service_role;
create policy published_releases_public_read on public.published_releases for select to anon, authenticated using (true);
create index published_releases_published_at_idx on public.published_releases (published_at desc);
comment on table public.published_releases is 'Immutable public release announcements, inserted only after deployment verification by trusted release tooling. No secrets or player data.';
commit;
