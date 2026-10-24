-- Run against a disposable local Supabase database after the migration.
-- This file always rolls back its fixtures. A failure aborts the transaction.
begin;

create function pg_temp.expect_error(statement text, expected_code text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_code then return; end if;
    raise exception 'Expected SQLSTATE %, received %: %', expected_code, sqlstate, sqlerrm;
  end;
  raise exception 'Expected SQLSTATE %, statement succeeded', expected_code;
end;
$$;
grant execute on function pg_temp.expect_error(text, text) to anon, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000101', 'island-admin-test@example.invalid'),
  ('00000000-0000-4000-8000-000000000102', 'island-player-test@example.invalid');
insert into public.world_admins (user_id) values ('00000000-0000-4000-8000-000000000101');

-- Record initial state without assuming the live world remains at revision zero.
create temporary table test_world_baseline as select * from public.world_settings;
grant select on test_world_baseline to anon, authenticated;

set local role anon;
do $$ begin
  assert (select count(*) from public.world_settings) = 1, 'public may read current settings';
end $$;
select pg_temp.expect_error('select * from public.world_setting_revisions', '42501');
select pg_temp.expect_error('select * from public.player_characters', '42501');
select pg_temp.expect_error('select public.publish_world_settings(''{}'', 0)', '42501');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);
do $$ begin
  assert (select count(*) from public.world_admins) = 0, 'nonadmin cannot read membership';
  assert (select count(*) from public.world_setting_revisions) = 0, 'nonadmin cannot read history';
end $$;
select pg_temp.expect_error('select public.publish_world_settings((select settings from public.world_settings), (select revision from public.world_settings))', '42501');
select pg_temp.expect_error('insert into public.world_admins values (auth.uid())', '42501');
select pg_temp.expect_error('update public.world_settings set revision = revision + 1', '42501');
select pg_temp.expect_error('delete from public.world_setting_revisions', '42501');

insert into public.player_characters (id, display_name) values ('00000000-0000-4000-8000-000000000201', 'Test Traveler');
insert into public.world_saves (save_data) values ('{"quest":"host progress"}');
select pg_temp.expect_error('insert into public.player_characters (owner_id,display_name) values (''00000000-0000-4000-8000-000000000101'', ''Stolen'')', '42501');
select pg_temp.expect_error('update public.player_characters set owner_id = ''00000000-0000-4000-8000-000000000101''', '42501');
select pg_temp.expect_error('insert into public.player_characters (variant) values (''unknown'')', '23514');
select pg_temp.expect_error('insert into public.player_characters (display_name) values (repeat(''x'',33))', '23514');
select pg_temp.expect_error('insert into public.player_characters (appearance) values (''[]'')', '23514');
update public.player_characters set display_name = 'Renamed Traveler';
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);
do $$ begin
  assert (select count(*) from public.world_admins) = 1, 'admin may read own membership';
  assert (select count(*) from public.player_characters) = 0, 'admin cannot read another player character';
  assert (select count(*) from public.world_saves) = 0, 'admin cannot read another host save';
end $$;
select pg_temp.expect_error('update public.world_settings set revision = revision + 1', '42501');
select pg_temp.expect_error('insert into public.world_setting_revisions (world_id,revision,settings) select id,revision+1,settings from public.world_settings', '42501');
select pg_temp.expect_error('select public.publish_world_settings(''{}'', (select revision from public.world_settings))', '22023');
select pg_temp.expect_error('select public.publish_world_settings((select settings || ''{"unexpected":true}'' from public.world_settings), (select revision from public.world_settings))', '22023');
select pg_temp.expect_error('select public.publish_world_settings((select settings || ''{"brightness":2}'' from public.world_settings), (select revision from public.world_settings))', '22023');
select pg_temp.expect_error('select public.publish_world_settings((select settings || ''{"brightness":"1"}'' from public.world_settings), (select revision from public.world_settings))', '22023');
select pg_temp.expect_error('select public.publish_world_settings((select settings || ''{"dayCycle":null}'' from public.world_settings), (select revision from public.world_settings))', '22023');
select pg_temp.expect_error('select public.publish_world_settings((select settings || ''{"cameraMode":"free"}'' from public.world_settings), (select revision from public.world_settings))', '22023');
select pg_temp.expect_error('select public.publish_world_settings((select settings || jsonb_build_object(''oversized'',repeat(''x'',17000)) from public.world_settings), (select revision from public.world_settings))', '22023');
select pg_temp.expect_error('select public.publish_world_settings((select settings from public.world_settings), null)', '40001');

select public.publish_world_settings(
  (select settings || '{"brightness":1.25,"cameraMode":"follow"}'::jsonb from public.world_settings),
  (select revision from public.world_settings)
);
do $$ begin
  assert (select revision from public.world_settings) = (select revision + 1 from test_world_baseline), 'publish increments once';
  assert (select updated_by from public.world_settings) = auth.uid(), 'audit stores actor';
  assert (select settings->>'brightness' from public.world_settings) = '1.25', 'publish stores config';
  assert exists (select 1 from public.world_setting_revisions as history
    join public.world_settings as current on current.id = history.world_id and current.revision = history.revision
    where current.settings = history.settings and current.updated_by = history.updated_by), 'history matches current';
end $$;
select pg_temp.expect_error('select public.publish_world_settings((select settings from public.world_settings), (select revision from test_world_baseline))', '40001');
reset role;

-- Removing an admin takes effect without waiting for JWT refresh.
delete from public.world_admins where user_id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select pg_temp.expect_error('select public.publish_world_settings((select settings from public.world_settings), (select revision from public.world_settings))', '42501');
reset role;

-- Data remains unchanged by rejected writes; seed revision is always preserved.
do $$ begin
  assert exists (select 1 from public.world_setting_revisions where world_id = 'default' and revision = 0), 'original revision is restorable';
  assert (select count(*) from public.player_characters where id = '00000000-0000-4000-8000-000000000201' and display_name = 'Renamed Traveler') = 1;
end $$;
rollback;
