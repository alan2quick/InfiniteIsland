-- World appearance is public; publishing is a versioned, database-authorized action.
-- Character saves belong to an Auth identity, never to a public display name.
begin;

create schema if not exists island_private;
revoke all on schema island_private from public, anon, authenticated;
grant usage on schema island_private to authenticated;

create function island_private.validate_world_settings(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  field text;
  low numeric;
  high numeric;
  allowed constant text[] := array[
    'hour', 'dayCycle', 'brightness', 'haze', 'breeze', 'water', 'butterflies',
    'musicTempo', 'musicVolume', 'natureVolume', 'cameraMode', 'cameraAngle',
    'cameraDistance', 'cameraSmoothness', 'intro'
  ];
begin
  if value is null or pg_catalog.jsonb_typeof(value) is distinct from 'object'
     or pg_catalog.octet_length(value::text) > 16384 then
    raise exception using errcode = '22023', message = 'Settings must be an object of at most 16 KiB';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(value) as keys(key) where not (key = any(allowed))) then
    raise exception using errcode = '22023', message = 'Unknown world setting';
  end if;
  for field, low, high in
    values ('hour', 0, 24), ('brightness', 0.5, 1.5), ('haze', 0, 1),
      ('breeze', 0, 1), ('water', 0, 1), ('butterflies', 0, 1),
      ('musicTempo', 0.5, 1.5), ('musicVolume', 0, 1), ('natureVolume', 0, 1),
      ('cameraAngle', 15, 70), ('cameraDistance', 5, 24), ('cameraSmoothness', 0, 1)
  loop
    -- JSONB numbers cannot represent NaN/Infinity. Numeric avoids float overflow.
    if pg_catalog.jsonb_typeof(value -> field) is distinct from 'number' then
      raise exception using errcode = '22023', message = 'Missing or nonnumeric world setting: ' || field;
    end if;
    if (value ->> field)::numeric not between low and high then
      raise exception using errcode = '22023', message = 'World setting outside allowed range: ' || field;
    end if;
  end loop;
  foreach field in array array['dayCycle', 'intro'] loop
    if pg_catalog.jsonb_typeof(value -> field) is distinct from 'boolean' then
      raise exception using errcode = '22023', message = 'Missing or nonboolean world setting: ' || field;
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(value -> 'cameraMode') is distinct from 'string'
     or (value ->> 'cameraMode') not in ('original', 'follow') then
    raise exception using errcode = '22023', message = 'Invalid camera mode';
  end if;
  return true;
end;
$$;
revoke all on function island_private.validate_world_settings(jsonb) from public, anon, authenticated;

create table public.world_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.world_settings (
  id text primary key default 'default' check (id = 'default'),
  settings jsonb not null check (island_private.validate_world_settings(settings)),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index world_settings_updated_by_idx on public.world_settings(updated_by);

create table public.world_setting_revisions (
  world_id text not null references public.world_settings(id),
  revision bigint not null check (revision >= 0),
  settings jsonb not null check (island_private.validate_world_settings(settings)),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (world_id, revision)
);
create index world_setting_revisions_updated_by_idx on public.world_setting_revisions(updated_by);

insert into public.world_settings (id, settings) values ('default', '{
  "hour":8,"dayCycle":true,"brightness":1,"haze":0.25,"breeze":0.5,
  "water":0.5,"butterflies":0.3,"musicTempo":0.8,"musicVolume":0.3,
  "natureVolume":1,"cameraMode":"original","cameraAngle":45,
  "cameraDistance":16,"cameraSmoothness":0.65,"intro":true
}'::jsonb);
insert into public.world_setting_revisions (world_id, revision, settings, updated_at, updated_by)
select id, revision, settings, updated_at, updated_by from public.world_settings;

alter table public.world_admins enable row level security;
alter table public.world_settings enable row level security;
alter table public.world_setting_revisions enable row level security;

-- Explicit grants handle projects whose Data API defaults do not expose new tables.
-- Also revoke inherited/default PUBLIC rights. Membership is bootstrapped in trusted SQL.
revoke all on public.world_admins, public.world_settings, public.world_setting_revisions from public, anon, authenticated;
grant select on public.world_settings to anon, authenticated;
grant select on public.world_admins, public.world_setting_revisions to authenticated;

create policy world_settings_read on public.world_settings for select to anon, authenticated using (true);
create policy world_admins_self on public.world_admins for select to authenticated
  using (user_id = (select auth.uid()));
create policy world_setting_revisions_admin on public.world_setting_revisions for select to authenticated
  using (exists (select 1 from public.world_admins where user_id = (select auth.uid())));

-- The privileged implementation is outside exposed API schemas. It always looks
-- up current membership in the database, never editable user_metadata or stale JWT claims.
create function island_private.publish_world_settings(new_settings jsonb, expected_revision bigint)
returns public.world_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  current_row public.world_settings;
begin
  if actor is null or not exists (select 1 from public.world_admins where user_id = actor) then
    raise exception using errcode = '42501', message = 'World admin access required';
  end if;
  perform island_private.validate_world_settings(new_settings);
  select * into strict current_row from public.world_settings where id = 'default' for update;
  if expected_revision is null or current_row.revision <> expected_revision then
    raise exception using errcode = '40001', message = 'World settings changed; reload before publishing';
  end if;
  update public.world_settings
    set settings = new_settings, revision = current_row.revision + 1,
        updated_at = pg_catalog.clock_timestamp(), updated_by = actor
    where id = 'default'
    returning * into current_row;
  insert into public.world_setting_revisions (world_id, revision, settings, updated_at, updated_by)
    values (current_row.id, current_row.revision, current_row.settings, current_row.updated_at, actor);
  return current_row;
end;
$$;
revoke all on function island_private.publish_world_settings(jsonb, bigint) from public, anon, authenticated;
grant execute on function island_private.publish_world_settings(jsonb, bigint) to authenticated;

-- Public API entrypoint is unprivileged; only the guarded private implementation
-- can write. A composite return gives clients the updated singleton row.
create function public.publish_world_settings(new_settings jsonb, expected_revision bigint)
returns public.world_settings
language sql
security invoker
set search_path = ''
as $$ select island_private.publish_world_settings(new_settings, expected_revision); $$;
revoke all on function public.publish_world_settings(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.publish_world_settings(jsonb, bigint) to authenticated;

create table public.player_characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null default 'Traveler' check (char_length(btrim(display_name)) between 1 and 32),
  variant text not null default 'original' check (variant in ('original', 'rowan', 'pip', 'marlow', 'clover', 'sunny')),
  appearance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(appearance) = 'object' and octet_length(appearance::text) <= 16384),
  save_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(save_data) = 'object' and octet_length(save_data::text) <= 1048576),
  updated_at timestamptz not null default now()
);
create index player_characters_owner_id_idx on public.player_characters(owner_id);
alter table public.player_characters enable row level security;
revoke all on public.player_characters from public, anon, authenticated;
grant select, insert, update, delete on public.player_characters to authenticated;
create policy player_characters_select on public.player_characters for select to authenticated
  using (owner_id = (select auth.uid()));
create policy player_characters_insert on public.player_characters for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy player_characters_update on public.player_characters for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy player_characters_delete on public.player_characters for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Shared host progress is a distinct document, never smuggled into a character.
create table public.world_saves (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  save_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(save_data) = 'object' and octet_length(save_data::text) <= 2097152),
  updated_at timestamptz not null default now()
);
alter table public.world_saves enable row level security;
revoke all on public.world_saves from public, anon, authenticated;
grant select, insert, update, delete on public.world_saves to authenticated;
create policy world_saves_select on public.world_saves for select to authenticated
  using (owner_id = (select auth.uid()));
create policy world_saves_insert on public.world_saves for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy world_saves_update on public.world_saves for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy world_saves_delete on public.world_saves for delete to authenticated
  using (owner_id = (select auth.uid()));

create function island_private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = pg_catalog.clock_timestamp(); return new; end;
$$;
revoke all on function island_private.touch_updated_at() from public, anon, authenticated;
create trigger player_characters_updated before update on public.player_characters
  for each row execute function island_private.touch_updated_at();
create trigger world_saves_updated before update on public.world_saves
  for each row execute function island_private.touch_updated_at();

-- Add only this table; leave all existing publication members unchanged.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'world_settings') then
    alter publication supabase_realtime add table public.world_settings;
  end if;
end;
$$;

commit;
