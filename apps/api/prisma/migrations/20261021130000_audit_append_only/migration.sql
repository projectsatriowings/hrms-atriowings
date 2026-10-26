-- B5a: make the audit log append-only at the database level.
-- The Prisma model is AuditLog, so the Postgres table is the quoted
-- identifier "AuditLog" (Prisma does not pluralise/underscore table names
-- unless @@map is set, and schema.prisma sets none for this model).
-- Any UPDATE or DELETE on any row raises an exception; only INSERT (and
-- SELECT) remain possible. This survives application bugs and any client
-- with direct DB access — the API's AuditService only ever INSERTs.
-- NOTE: do NOT run `prisma migrate deploy` from a workstream agent; the
-- coordinator deploys all migrations at the final gate.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit log is append-only: % is not allowed', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON "AuditLog";
DROP TRIGGER IF EXISTS audit_log_no_delete ON "AuditLog";
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
