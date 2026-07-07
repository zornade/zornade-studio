-- Zornade Studio: own minimal user profile (Fase 2, roadmap - revised
-- 2026-07-07 after the "dedicated Supabase project" pivot).
--
-- Studio has its OWN Supabase project (not shared with app/ - see
-- /memories/repo/zornade-studio-oss-own-project-2026-07-06.md), so it needs
-- its OWN profile table + its OWN auto-create-on-signup trigger, instead of
-- depending on app/'s `public.user_profiles`/`handle_new_user()`. Kept
-- deliberately minimal: Studio has no gamification/newsletter/XP concerns
-- (those are app/-specific), just what the sharing UI needs to display a
-- collaborator (username, avatar).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Zornade Studio: minimal per-user profile (username/avatar for the sharing UI). Own project, not shared with app/.';

alter table public.profiles enable row level security;

-- Explicit Data API privileges (see auto_expose_new_tables note elsewhere -
-- newer Supabase projects do not auto-expose new tables without a GRANT).
grant select, update on public.profiles to authenticated;
revoke all on public.profiles from anon;

-- Everyone (any authenticated Studio user) can see basic profile info of
-- any other user - needed so the sharing UI can show "shared by X" and
-- resolve collaborator names; nothing sensitive is stored here.
create policy profiles_select_authenticated
  on public.profiles for select
  to authenticated
  using (true);

-- A user may only update their own profile (e.g. future "edit your name").
create policy profiles_update_self
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.profiles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.profiles_touch_updated_at();

-- Auto-create a profile row for every new signup (mirrors app/'s own
-- handle_new_user() pattern, but this is Studio's OWN trigger on Studio's
-- OWN auth.users - no cross-product dependency, no risk to any other
-- product). Default username from the email's local part; NULL-safe.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
