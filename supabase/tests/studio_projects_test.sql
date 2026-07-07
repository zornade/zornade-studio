-- Zornade Studio: pgTAP suite for studio_projects / studio_project_collaborators
-- / profiles (Fase 2, roadmap - revised 2026-07-07 for Studio's OWN
-- dedicated Supabase project, ref rjgejjzonhxojsdbzced).
--
-- HOW TO RUN (never against production - see supabase/config.toml):
--   1. Create an isolated preview branch:
--        supabase branches create studio-schema-test --project-ref rjgejjzonhxojsdbzced
--   2. Push these migrations to that branch (not to production).
--   3. Run this file against the branch's Postgres connection string, e.g.:
--        psql "$BRANCH_DB_URL" -f supabase/tests/studio_projects_test.sql
--   4. Delete the branch when done:
--        supabase branches delete studio-schema-test --project-ref rjgejjzonhxojsdbzced
--
-- The whole script runs inside ONE transaction that is ALWAYS rolled back at
-- the end (see `rollback;` on the last line) - regardless of pass/fail - so
-- it never leaves test data behind, even on a shared database.
--
-- Technique for impersonating a Postgres/Supabase role without a real HTTP
-- request: `reset role; set local role <anon|authenticated>; set local
-- request.jwt.claims = '{"sub":"<uuid>"}';` - this is exactly what auth.uid()
-- reads (Supabase's own documented RLS-testing recipe). `reset role` first
-- is required because Postgres SET ROLE needs membership in the target role;
-- the connecting admin role is a member of anon/authenticated/service_role,
-- but anon/authenticated are NOT members of each other.

begin;

select plan(38);

-- ---------------------------------------------------------------------
-- 0. Structure sanity
-- ---------------------------------------------------------------------
select has_table('public', 'studio_projects', 'studio_projects table exists');
select has_table('public', 'studio_project_collaborators', 'studio_project_collaborators table exists');
select has_table('public', 'profiles', 'profiles table exists (Studio''s own, not app/''s)');

-- ---------------------------------------------------------------------
-- 1. Setup: throwaway auth.users rows (rolled back at the end, never
--    real signups - RFC 2606 .invalid email domain, on purpose never
--    resolvable/deliverable).
-- ---------------------------------------------------------------------
create temporary table test_ids (key text primary key, value uuid) on commit drop;
-- This scratch table is created while connected as the admin/superuser role,
-- but the script switches to `authenticated`/`anon` throughout via SET LOCAL
-- ROLE to exercise RLS as different users - grant them access to it too, or
-- every later read/write from a non-admin role fails with a plain permission
-- error (unrelated to anything we are actually testing).
grant all on test_ids to authenticated, anon;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'owner-test@example.invalid', crypt('x', gen_salt('bf')), now(),
   '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'editor-test@example.invalid', crypt('x', gen_salt('bf')), now(),
   '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'viewer-test@example.invalid', crypt('x', gen_salt('bf')), now(),
   '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'outsider-test@example.invalid', crypt('x', gen_salt('bf')), now(),
   '{}', '{}', now(), now(), '', '', '', '');

-- NOTE (revised 2026-07-07): studio_find_collaborator_candidate() joins
-- public.profiles, which is Studio's OWN table with its OWN
-- handle_new_user() trigger (see migration 20260706120150) - no longer a
-- stand-in for app/'s table. The auth.users inserts above already
-- auto-created matching public.profiles rows via that trigger; nothing
-- extra to set up here.

select lives_ok(
  $$ select 1 $$,
  'setup: throwaway auth.users rows for owner/editor/viewer/outsider created'
);

-- ---------------------------------------------------------------------
-- 2. Owner creates a project; RLS visibility per role
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

with new_project as (
  insert into public.studio_projects (owner_id, name, state, schema_version)
  values ('a0000000-0000-0000-0000-000000000001', 'Progetto di test', '{"vizType":"choropleth"}'::jsonb, 1)
  returning id
)
insert into test_ids select 'project1', id from new_project;

select is(
  (select count(*)::int from public.studio_projects where id = (select value from test_ids where key = 'project1')),
  1,
  'owner: SELECT sees their own newly created project'
);

select throws_ok(
  $$ insert into public.studio_projects (owner_id, name, state, schema_version)
     values ('a0000000-0000-0000-0000-000000000004', 'spoofed', '{}'::jsonb, 1) $$,
  '42501'
);

select throws_ok(
  $$ insert into public.studio_projects (owner_id, name, state, schema_version)
     values ('a0000000-0000-0000-0000-000000000001', '   ', '{}'::jsonb, 1) $$,
  '23514'
);

select throws_ok(
  $$ insert into public.studio_project_collaborators (project_id, invited_email, role, invited_by)
     values ((select value from test_ids where key='project1'), 'bad-role@example.invalid', 'admin', 'a0000000-0000-0000-0000-000000000001') $$,
  '23514'
);

-- Outsider (authenticated, but not owner/collaborator) must see 0 rows.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}';

select is(
  (select count(*)::int from public.studio_projects where id = (select value from test_ids where key = 'project1')),
  0,
  'RLS: non-collaborator authenticated user sees 0 rows for someone else''s project'
);

-- anon: privilege-level deny (no GRANT at all), independent of RLS.
reset role;
set local role anon;

select throws_ok(
  $$ select 1 from public.studio_projects limit 1 $$,
  '42501'
);

-- ---------------------------------------------------------------------
-- 3. Collaborators: add editor + viewer, check role-based access
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

with c as (
  insert into public.studio_project_collaborators (project_id, user_id, role, invited_by)
  values ((select value from test_ids where key = 'project1'), 'a0000000-0000-0000-0000-000000000002', 'editor', 'a0000000-0000-0000-0000-000000000001')
  returning id
)
insert into test_ids select 'collab_editor', id from c;

insert into public.studio_project_collaborators (project_id, user_id, role, invited_by)
values ((select value from test_ids where key = 'project1'), 'a0000000-0000-0000-0000-000000000003', 'viewer', 'a0000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ insert into public.studio_project_collaborators (project_id, user_id, role, invited_by)
     values ((select value from test_ids where key='project1'), 'a0000000-0000-0000-0000-000000000002', 'viewer', 'a0000000-0000-0000-0000-000000000001') $$,
  '23505'
);

-- (a) A non-owner (outsider) cannot insert a collaborator row, period -
-- even citing themselves as a truthful invited_by.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ insert into public.studio_project_collaborators (project_id, invited_email, role, invited_by)
     values ((select value from test_ids where key='project1'), 'nope@example.invalid', 'viewer', 'a0000000-0000-0000-0000-000000000004') $$,
  '42501'
);

-- (b) The real owner cannot spoof invited_by to someone else.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.studio_project_collaborators (project_id, invited_email, role, invited_by)
     values ((select value from test_ids where key='project1'), 'nope2@example.invalid', 'viewer', 'a0000000-0000-0000-0000-000000000004') $$,
  '42501'
);

-- Now the real, valid invite (as the actual owner, invited_by = owner).
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.studio_project_collaborators (project_id, invited_email, role, invited_by)
values ((select value from test_ids where key = 'project1'), 'Invitee@Example.INVALID', 'editor', 'a0000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ insert into public.studio_project_collaborators (project_id, invited_email, role, invited_by)
     values ((select value from test_ids where key='project1'), 'invitee@example.invalid', 'viewer', 'a0000000-0000-0000-0000-000000000001') $$,
  '23505'
);

-- editor: can SELECT + UPDATE content
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.studio_projects where id = (select value from test_ids where key = 'project1')),
  1,
  'editor: SELECT sees the shared project'
);

select lives_ok(
  $$ update public.studio_projects set name = 'Rinominato dall''editor'
     where id = (select value from test_ids where key = 'project1') $$,
  'editor: can UPDATE project content (name)'
);

select throws_ok(
  format(
    $$ update public.studio_projects set owner_id = 'a0000000-0000-0000-0000-000000000002' where id = %L $$,
    (select value from test_ids where key = 'project1')
  ),
  '42501'
);

-- viewer: can SELECT, cannot UPDATE (RLS silently matches 0 rows, no error)
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*)::int from public.studio_projects where id = (select value from test_ids where key = 'project1')),
  1,
  'viewer: SELECT sees the shared project'
);

update public.studio_projects set name = 'Il viewer non dovrebbe riuscirci'
where id = (select value from test_ids where key = 'project1');

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select name from public.studio_projects where id = (select value from test_ids where key = 'project1')),
  'Rinominato dall''editor',
  'viewer UPDATE had no effect (RLS filtered it to 0 matched rows, not an error)'
);

-- viewer removes themselves ("leave project"); editor cannot remove others.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';

delete from public.studio_project_collaborators
where project_id = (select value from test_ids where key = 'project1')
  and user_id = 'a0000000-0000-0000-0000-000000000003'; -- editor trying to remove the viewer

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.studio_project_collaborators
     where project_id = (select value from test_ids where key = 'project1')
       and user_id = 'a0000000-0000-0000-0000-000000000003'),
  1,
  'editor cannot remove another collaborator (viewer row still present)'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ delete from public.studio_project_collaborators
     where project_id = (select value from test_ids where key = 'project1')
       and user_id = 'a0000000-0000-0000-0000-000000000003' $$,
  'viewer can remove themselves ("leave project")'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.studio_project_collaborators
     where project_id = (select value from test_ids where key = 'project1')
       and user_id = 'a0000000-0000-0000-0000-000000000003'),
  0,
  'viewer self-removal actually deleted the row'
);

-- ---------------------------------------------------------------------
-- 4. owner_id is immutable, even for the actual owner (no
--    ownership-transfer feature in v1 - see the guard trigger's comment
--    in the core migration for why it would conflict with RLS anyway).
--    Uses a dedicated project so it does not disturb project1's state.
-- ---------------------------------------------------------------------
with new_project as (
  insert into public.studio_projects (owner_id, name, state, schema_version)
  values ('a0000000-0000-0000-0000-000000000001', 'Progetto owner_id immutabile', '{}'::jsonb, 1)
  returning id
)
insert into test_ids select 'project_immutable', id from new_project;

select throws_ok(
  format(
    $$ update public.studio_projects set owner_id = 'a0000000-0000-0000-0000-000000000004' where id = %L $$,
    (select value from test_ids where key = 'project_immutable')
  ),
  '42501'
);

select is(
  (select owner_id from public.studio_projects where id = (select value from test_ids where key = 'project_immutable')),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'owner_id truly unchanged after the rejected attempt (even by the real owner)'
);

-- ---------------------------------------------------------------------
-- 5. Claim-on-signup trigger: deferred confirmation (password flow)
-- ---------------------------------------------------------------------
reset role; -- back to admin/superuser for direct auth.users manipulation

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000006',
  'authenticated', 'authenticated', 'invitee@example.invalid', crypt('x', gen_salt('bf')), null,
  '{}', '{}', now(), now(), '', '', '', ''
);

select is(
  (select user_id from public.studio_project_collaborators
     where project_id = (select value from test_ids where key = 'project1')
       and lower(invited_email) = 'invitee@example.invalid'),
  null::uuid,
  'unconfirmed signup does NOT claim the pending invite yet (email_confirmed_at still null)'
);

update auth.users set email_confirmed_at = now()
where id = 'a0000000-0000-0000-0000-000000000006';

select is(
  (select user_id from public.studio_project_collaborators
     where project_id = (select value from test_ids where key = 'project1')
       and lower(invited_email) = 'invitee@example.invalid'),
  'a0000000-0000-0000-0000-000000000006'::uuid,
  'confirming the email later claims the pending invite (case-insensitive email match)'
);

select isnt(
  (select accepted_at from public.studio_project_collaborators
     where project_id = (select value from test_ids where key = 'project1')
       and lower(invited_email) = 'invitee@example.invalid'),
  null,
  'claimed invite has accepted_at set'
);

-- Trigger interplay: Studio's OWN handle_new_user() (creates public.profiles,
-- see migration 20260706120150) and our claim-invite trigger are two
-- independent AFTER INSERT triggers on the SAME auth.users table, in the
-- SAME dedicated project. Verify both actually fired for this signup.
select is(
  (select count(*)::int from public.profiles where id = 'a0000000-0000-0000-0000-000000000006'),
  1,
  'trigger interplay: handle_new_user() created a profiles row for the same signup, unaffected by the claim trigger'
);

-- OAuth-style signup: email_confirmed_at already set AT INSERT time.
insert into public.studio_project_collaborators (project_id, invited_email, role, invited_by)
values ((select value from test_ids where key = 'project1'), 'oauth-invitee@example.invalid', 'viewer', 'a0000000-0000-0000-0000-000000000001');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000007',
  'authenticated', 'authenticated', 'oauth-invitee@example.invalid', crypt('x', gen_salt('bf')), now(),
  '{}', '{}', now(), now(), '', '', '', ''
);

select is(
  (select user_id from public.studio_project_collaborators
     where project_id = (select value from test_ids where key = 'project1')
       and lower(invited_email) = 'oauth-invitee@example.invalid'),
  'a0000000-0000-0000-0000-000000000007'::uuid,
  'AFTER INSERT trigger claims an already-confirmed (OAuth-style) signup immediately'
);

-- ---------------------------------------------------------------------
-- 6. RPC studio_find_collaborator_candidate
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select user_id from public.studio_find_collaborator_candidate('OWNER-TEST@Example.Invalid')),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'RPC finds a confirmed user by email, case-insensitively'
);

select is(
  (select count(*)::int from public.studio_find_collaborator_candidate('invitee@example.invalid')
     where user_id = 'a0000000-0000-0000-0000-000000000006'),
  1,
  'RPC finds the now-confirmed formerly-pending invitee too'
);

select is(
  (select count(*)::int from public.studio_find_collaborator_candidate('nobody-such-address@example.invalid')),
  0,
  'RPC returns no rows for a nonexistent email'
);

reset role;
set local role anon;

select throws_ok(
  $$ select * from public.studio_find_collaborator_candidate('owner-test@example.invalid') $$,
  '42501'
);

-- ---------------------------------------------------------------------
-- 6.5 Soft-delete guard: only the owner may change deleted_at (editors
--     can update other content fields, per studio_projects_update_editor,
--     but must NOT be able to soft-delete - a row-level UPDATE policy has
--     no column granularity, so this needs the same OLD/NEW trigger
--     technique as the owner_id immutability guard).
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  format(
    $$ update public.studio_projects set deleted_at = now() where id = %L $$,
    (select value from test_ids where key = 'project1')
  ),
  '42501'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  format(
    $$ update public.studio_projects set deleted_at = now() where id = %L $$,
    (select value from test_ids where key = 'project1')
  ),
  'owner CAN soft-delete (set deleted_at)'
);

select lives_ok(
  format(
    $$ update public.studio_projects set deleted_at = null where id = %L $$,
    (select value from test_ids where key = 'project1')
  ),
  'owner CAN restore (clear deleted_at) - undo soft-delete'
);

-- ---------------------------------------------------------------------
-- 7. Cascade delete
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ delete from public.studio_projects where id = (select value from test_ids where key = 'project1') $$,
  'owner can delete their project'
);

reset role; -- admin, to check across all rows regardless of RLS

select is(
  (select count(*)::int from public.studio_project_collaborators
     where project_id = (select value from test_ids where key = 'project1')),
  0,
  'ON DELETE CASCADE removed all collaborator rows for the deleted project'
);

select * from finish();

rollback;
