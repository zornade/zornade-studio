-- Zornade Studio: restrict soft-delete (deleted_at) to the project owner
-- (Fase 4, 2026-07-07).
--
-- studio_projects_update_editor allows an editor collaborator to UPDATE ANY
-- column (RLS's USING/WITH CHECK is row-level, not column-level), including
-- deleted_at - which would let an editor "soft delete" a project despite
-- studio_projects_delete_owner explicitly restricting hard DELETE to the
-- owner ("editors/viewers can never delete", see the collaborators
-- migration). Closes that gap the same way
-- studio_projects_guard_owner_change closes the owner_id one: a BEFORE
-- UPDATE trigger comparing OLD/NEW, which a row-level policy cannot express
-- on its own.

create or replace function public.studio_projects_guard_editor_delete()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is distinct from old.deleted_at and auth.uid() <> old.owner_id then
    raise exception 'Only the project owner can delete/restore this project'
      using errcode = '42501'; -- insufficient_privilege
  end if;
  return new;
end;
$$;

drop trigger if exists studio_projects_guard_editor_delete_trg on public.studio_projects;
create trigger studio_projects_guard_editor_delete_trg
  before update on public.studio_projects
  for each row
  execute function public.studio_projects_guard_editor_delete();
