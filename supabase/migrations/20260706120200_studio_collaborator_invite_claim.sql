-- Zornade Studio: invite-by-email claim + safe collaborator lookup
-- (Fase 2, roadmap - revised 2026-07-07 after the "dedicated Supabase
-- project" pivot).
--
-- Two AFTER triggers on auth.users (alongside Studio's OWN
-- `on_auth_user_created` -> handle_new_user(), created in the previous
-- migration - NOT app/'s, this project has no other product on it) resolve
-- a pending studio_project_collaborators.invited_email row to a real
-- user_id once - and only once - that email address is CONFIRMED:
--
--   1. AFTER INSERT: covers OAuth/magic-link signups, where email_confirmed_at
--      is already set at the moment the auth.users row is created.
--   2. AFTER UPDATE OF email_confirmed_at (null -> not null): covers the
--      password+confirm-email flow, where the auth.users row is created
--      UNCONFIRMED first and confirmed later by clicking the email link.
--
-- Security rationale for gating on email_confirmed_at (not just "any new
-- auth.users row"): claiming on raw INSERT alone would let anyone create an
-- (unconfirmed) account with a victim's email address and have a pending
-- invite silently attached to that new user_id, before ever proving they
-- control that inbox. Supabase Auth already refuses to hand out a session
-- to an unconfirmed account (this project already requires "Confirm email"
-- - see memory), so today's practical risk is low, but gating explicitly
-- here means correctness does not depend on that project setting either.
create or replace function public.studio_claim_pending_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is null or new.email is null then
    return new;
  end if;

  update public.studio_project_collaborators
  set user_id = new.id,
      accepted_at = now()
  where invited_email is not null
    and user_id is null
    and lower(invited_email) = lower(new.email);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_claim_studio_invites on auth.users;
create trigger on_auth_user_created_claim_studio_invites
  after insert on auth.users
  for each row
  execute function public.studio_claim_pending_invites();

drop trigger if exists on_auth_user_confirmed_claim_studio_invites on auth.users;
create trigger on_auth_user_confirmed_claim_studio_invites
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.studio_claim_pending_invites();

-- Safe, minimal "does this email belong to a Zornade account?" lookup for
-- the share dialog. auth.users is NEVER queryable directly by anon/
-- authenticated clients; this SECURITY DEFINER function returns only the
-- 3 fields the UI needs (id/username/avatar), and only for CONFIRMED
-- accounts, never the email itself back (avoids trivially turning this
-- into an email-echo oracle; it is still, by design, an email-existence
-- oracle for authenticated callers - acceptable for an invite-search
-- feature, same trade-off as e.g. "forgot password" flows).
create or replace function public.studio_find_collaborator_candidate(p_email text)
returns table (user_id uuid, username text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select u.id, p.username, p.avatar_url
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.email_confirmed_at is not null
      and lower(u.email) = lower(p_email)
    limit 1;
end;
$$;

revoke all on function public.studio_find_collaborator_candidate(text) from public;
revoke all on function public.studio_find_collaborator_candidate(text) from anon;
grant execute on function public.studio_find_collaborator_candidate(text) to authenticated;
