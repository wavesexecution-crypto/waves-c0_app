-- WavesCo PostgreSQL bootstrap (runs on first container start as superuser).
-- Creates the runtime application role used by DATABASE_URL. Table ownership
-- stays with `wavesco` (the migration role) so RLS actually applies to the app.
-- Tables created in the future (module schemas, Phase 6) inherit these grants
-- via ALTER DEFAULT PRIVILEGES.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wavesco_app') THEN
    CREATE ROLE wavesco_app LOGIN PASSWORD 'wavesco_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO wavesco_app;

ALTER DEFAULT PRIVILEGES FOR ROLE wavesco IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wavesco_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wavesco IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wavesco_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wavesco IN SCHEMA public
  GRANT USAGE ON FUNCTIONS TO wavesco_app;
