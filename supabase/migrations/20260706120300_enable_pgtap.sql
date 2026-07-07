-- Enable pgTAP for the automated test suite in supabase/tests/ (approved by
-- the user 2026-07-06, to run against an isolated preview branch, never
-- directly against production - see supabase/config.toml).
create extension if not exists pgtap with schema extensions;
