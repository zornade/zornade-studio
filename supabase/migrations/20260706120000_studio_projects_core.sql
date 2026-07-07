-- Zornade Studio: project persistence (Fase 2, roadmap - revised 2026-07-07
-- after the "dedicated Supabase project" pivot, see
-- /memories/repo/zornade-studio-oss-own-project-2026-07-06.md).
--
-- A "project" is the full editable Studio state (see src/lib/project.ts,
-- ProjectFile.state = StudioState). Until now it only ever existed as a
-- JSON file the operator downloaded/re-uploaded by hand. This table adds
-- server-side persistence in Studio's OWN dedicated Supabase project (not
-- shared with app/), so a project can be reopened from any device and
-- later shared with collaborators (see the next migrations).
--
-- This migration only ADDS new tables in Studio's own project. It has no
-- effect on any other Zornade product.

create table if not exists public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  -- Full serialised StudioState (see src/lib/project.ts SavableProject).
  -- Validated client-side by parseProject() before every write; the
  -- server only needs to store it as an opaque JSON document.
  state jsonb not null,
  -- Mirrors PROJECT_SCHEMA_VERSION in src/lib/project.ts, so a future
  -- incompatible shape change can be detected/migrated server-side too.
  schema_version integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete: keeps the row (and any collaborator grants) around for a
  -- "trash" / undo UX instead of losing data on an accidental delete.
  deleted_at timestamptz
);

comment on table public.studio_projects is
  'Zornade Studio: server-saved editor projects (full StudioState snapshot). Own dedicated Supabase project, not shared with app/.';
comment on column public.studio_projects.state is
  'Opaque JSON, see src/lib/project.ts SavableProject/ProjectFile. Validated client-side, not server-side.';

-- Fast "list my projects" (excludes soft-deleted rows from the common case).
create index if not exists studio_projects_owner_id_idx
  on public.studio_projects (owner_id)
  where deleted_at is null;

-- Auto-touch updated_at on every UPDATE (application code never sets it
-- directly, avoiding clock-skew/spoofing from the client).
create or replace function public.studio_projects_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists studio_projects_set_updated_at on public.studio_projects;
create trigger studio_projects_set_updated_at
  before update on public.studio_projects
  for each row
  execute function public.studio_projects_touch_updated_at();

-- owner_id is IMMUTABLE after creation (no ownership-transfer feature in
-- v1 - not part of the actual requirements, and it would conflict with RLS
-- anyway: PostgreSQL requires an UPDATE's resulting row to also pass the
-- table's SELECT policies whenever the query reads a column, per docs
-- https://www.postgresql.org/docs/current/sql-createpolicy.html table
-- "Policies Applied by Command Type" footnote [a] - so transferring
-- ownership away would make the row invisible to the very owner making
-- the change and Postgres would reject the UPDATE outright; confirmed by
-- actually hitting this on an isolated preview branch, 2026-07-06).
-- This trigger also closes the privilege-escalation hole where an editor
-- collaborator could otherwise overwrite owner_id to themselves through
-- an allowed UPDATE (a USING/WITH CHECK clause alone cannot compare
-- against the OLD row to detect that owner_id specifically changed).
create or replace function public.studio_projects_guard_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Project ownership cannot be changed (owner_id is immutable)'
      using errcode = '42501'; -- insufficient_privilege
  end if;
  return new;
end;
$$;

drop trigger if exists studio_projects_guard_owner_change_trg on public.studio_projects;
create trigger studio_projects_guard_owner_change_trg
  before update on public.studio_projects
  for each row
  execute function public.studio_projects_guard_owner_change();

