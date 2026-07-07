-- Zornade Studio: sharing/collaboration (Fase 2, roadmap 2026-07-06).
--
-- Collaborators can be added either by an existing user_id (already has a
-- Zornade account) or by invited_email (pending invite, no account yet).
-- The claim-on-signup trigger that resolves invited_email -> user_id lives
-- in the next migration (needs auth.users, kept separate for clarity).

create table if not exists public.studio_project_collaborators (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects (id) on delete cascade,
  -- Filled immediately for an existing user; left null for a pending
  -- email invite until claimed (see the claim-invite migration).
  user_id uuid references auth.users (id) on delete cascade,
  -- Kept even after the invite is claimed (audit trail: "invited via this
  -- address"), so this is NOT cleared on claim - see the check constraint
  -- below, which only requires "at least one of the two", not "exactly one".
  invited_email text,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint studio_collab_user_or_email check (
    user_id is not null or invited_email is not null
  )
);

comment on table public.studio_project_collaborators is
  'Zornade Studio: per-project sharing grants (owner/editor/viewer), by user_id or pending invited_email.';

-- One grant per (project, user) - prevents duplicate/conflicting roles for
-- the same person on the same project.
create unique index if not exists studio_collab_project_user_uniq
  on public.studio_project_collaborators (project_id, user_id)
  where user_id is not null;

-- One grant per (project, email) - prevents inviting the same address
-- twice to the same project (case-insensitive: Supabase emails are stored
-- lowercase in practice, but this does not rely on that).
create unique index if not exists studio_collab_project_email_uniq
  on public.studio_project_collaborators (project_id, lower(invited_email))
  where invited_email is not null;

create index if not exists studio_collab_user_id_idx
  on public.studio_project_collaborators (user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.studio_projects enable row level security;
alter table public.studio_project_collaborators enable row level security;

-- Explicit Data API privileges. Newer Supabase projects do NOT
-- auto-expose new public-schema tables to the anon/authenticated roles
-- without an explicit GRANT (see supabase/config.toml
-- `auto_expose_new_tables` comment) - relying on an implicit default here
-- would be a correctness gamble depending on when this project's default
-- privileges were provisioned. `authenticated` gets full DML (the actual
-- gate is RLS above); `anon` gets NOTHING on these two tables - Studio's
-- saved projects/sharing are never meant to be readable without a session.
grant select, insert, update, delete on public.studio_projects to authenticated;
grant select, insert, update, delete on public.studio_project_collaborators to authenticated;
revoke all on public.studio_projects from anon;
revoke all on public.studio_project_collaborators from anon;

-- Cross-table RLS helpers, SECURITY DEFINER on purpose.
--
-- A policy on studio_projects that queries studio_project_collaborators (to
-- check "is this caller a collaborator?"), combined with a policy on
-- studio_project_collaborators that queries studio_projects back (to check
-- "is this caller the project owner?"), makes Postgres re-evaluate each
-- table's RLS while evaluating the other's - an infinite loop that fails
-- with "infinite recursion detected in policy for relation ...". Confirmed
-- by actually running this on an isolated Supabase preview branch
-- (2026-07-06), not just reasoned about: the very first INSERT into
-- studio_projects (whose RETURNING clause is SELECT-policy-checked) failed
-- with exactly that error, because studio_projects_select_collaborator
-- queried the collaborators table, whose own SELECT policy queried
-- studio_projects back.
--
-- The standard Supabase-documented fix: wrap each cross-table check in a
-- SECURITY DEFINER function. Owned by the migration-running admin role
-- (which has BYPASSRLS on Supabase), the query INSIDE the function does
-- not re-trigger the other table's RLS, breaking the cycle.
create or replace function public.studio_is_project_owner(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.studio_projects p
    where p.id = p_project_id
      and p.owner_id = auth.uid()
  );
$$;

create or replace function public.studio_collaborator_role(p_project_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select c.role
  from public.studio_project_collaborators c
  where c.project_id = p_project_id
    and c.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.studio_is_project_owner(uuid) from public, anon;
grant execute on function public.studio_is_project_owner(uuid) to authenticated;
revoke all on function public.studio_collaborator_role(uuid) from public, anon;
grant execute on function public.studio_collaborator_role(uuid) to authenticated;

-- studio_projects: SELECT
create policy studio_projects_select_owner
  on public.studio_projects for select
  using (owner_id = auth.uid());

create policy studio_projects_select_collaborator
  on public.studio_projects for select
  using (public.studio_collaborator_role(id) is not null);

-- studio_projects: INSERT (you can only create a project you own)
create policy studio_projects_insert_owner
  on public.studio_projects for insert
  with check (owner_id = auth.uid());

-- studio_projects: UPDATE (owner: any content field; owner_id itself is
-- immutable, enforced by studio_projects_guard_owner_change_trg in the
-- previous migration - no ownership-transfer feature in v1, see that
-- trigger's comment for why allowing it would conflict with RLS anyway)
create policy studio_projects_update_owner
  on public.studio_projects for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy studio_projects_update_editor
  on public.studio_projects for update
  using (public.studio_collaborator_role(id) = 'editor')
  with check (public.studio_collaborator_role(id) = 'editor');

-- studio_projects: DELETE (owner only - editors/viewers can never delete)
create policy studio_projects_delete_owner
  on public.studio_projects for delete
  using (owner_id = auth.uid());

-- studio_project_collaborators: SELECT (project owner sees the full list;
-- a collaborator sees only their own row)
create policy studio_collab_select_owner
  on public.studio_project_collaborators for select
  using (public.studio_is_project_owner(project_id));

create policy studio_collab_select_self
  on public.studio_project_collaborators for select
  using (user_id = auth.uid());

-- studio_project_collaborators: INSERT (owner only, MVP - sharing
-- management is not delegated to editors for now; invited_by must match
-- the caller so the audit trail cannot be spoofed)
create policy studio_collab_insert_owner
  on public.studio_project_collaborators for insert
  with check (
    invited_by = auth.uid()
    and public.studio_is_project_owner(project_id)
  );

-- studio_project_collaborators: UPDATE (owner only - role changes)
create policy studio_collab_update_owner
  on public.studio_project_collaborators for update
  using (public.studio_is_project_owner(project_id))
  with check (public.studio_is_project_owner(project_id));

-- studio_project_collaborators: DELETE (owner removes anyone; a
-- collaborator may remove themselves - "leave project")
create policy studio_collab_delete_owner
  on public.studio_project_collaborators for delete
  using (public.studio_is_project_owner(project_id));

create policy studio_collab_delete_self
  on public.studio_project_collaborators for delete
  using (user_id = auth.uid());
