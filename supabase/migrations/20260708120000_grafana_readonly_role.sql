-- Read-only monitoring role for Grafana (umami-pg-style pattern already used
-- on the app.zornade.com / Umami Postgres instances). SELECT-only on public
-- schema, no write/DDL privileges whatsoever.
--
-- SECURITY NOTE: this migration embeds a real password so it can be applied
-- non-interactively via `supabase db push`. The role is intentionally
-- low-privilege (SELECT-only, no PII beyond what the app's own RLS already
-- exposes). If you prefer not to keep a real secret in git history, rotate
-- the password afterwards with:
--   ALTER ROLE grafana_ro WITH PASSWORD '<new-password>';
-- and update grafana/.env (STUDIO_DB_PASSWORD) + the droplet's .env to match.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_ro') THEN
    CREATE ROLE grafana_ro WITH LOGIN PASSWORD 'nAhtd89eHSic9Cjf9Z0ECUaszEdvc';
  ELSE
    ALTER ROLE grafana_ro WITH LOGIN PASSWORD 'nAhtd89eHSic9Cjf9Z0ECUaszEdvc';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO grafana_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_ro;
