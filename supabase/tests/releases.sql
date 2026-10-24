-- Embedded role tests: announcement reads are public; every browser identity is read-only.
begin;
create function pg_temp.release_expect_error(command text, wanted text)
returns void language plpgsql as $$ begin
  begin execute command; exception when others then
    if sqlstate = wanted then return; end if; raise;
  end;
  raise exception 'Expected SQLSTATE % for %', wanted, command;
end $$;
set local role service_role;
insert into public.published_releases (version,commit_sha,title,changes,note,github_url,deployment_url,deployed_at)
values ('0.83.0', repeat('a',40), 'Campfire & World Editor', '["Choose at the campfire"]', '', 'https://github.com/Stephenitis/InfiniteIsland/releases/tag/v0.83.0', 'https://infinite-island.example', now());
select pg_temp.release_expect_error('update public.published_releases set title = ''Changed''', '42501');
select pg_temp.release_expect_error('delete from public.published_releases', '42501');
select pg_temp.release_expect_error('insert into public.published_releases (version,commit_sha,title,changes,github_url,deployment_url,deployed_at) values (''0.83.1'', repeat(''a'',40), ''Bad'', ''[{}]'', ''https://github.com/Stephenitis/InfiniteIsland/releases/tag/v0.83.1'', ''https://infinite-island.example'', now())', '23514');
reset role;
set local role anon;
do $$ begin assert (select count(*) from public.published_releases) = 1, 'signed-out players may read published product notes'; end $$;
select pg_temp.release_expect_error('insert into public.published_releases (version) values (''0.83.1'')', '42501');
select pg_temp.release_expect_error('update public.published_releases set title = ''Changed''', '42501');
select pg_temp.release_expect_error('delete from public.published_releases', '42501');
reset role;
set local role authenticated;
do $$ begin assert (select count(*) from public.published_releases) = 1, 'signed-in admins and players may read the same public notes'; end $$;
select pg_temp.release_expect_error('insert into public.published_releases (version) values (''0.83.1'')', '42501');
select pg_temp.release_expect_error('update public.published_releases set title = ''Changed''', '42501');
select pg_temp.release_expect_error('delete from public.published_releases', '42501');
reset role;
rollback;
