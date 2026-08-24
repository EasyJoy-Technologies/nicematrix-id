-- Roll back only after Backend LOGTO_DB_URL no longer uses this role.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'nicematrix_backend_maintenance'
  ) THEN
    DROP OWNED BY nicematrix_backend_maintenance;
    DROP ROLE nicematrix_backend_maintenance;
  END IF;
END
$$;
