-- Reviewed manual rollback. Apply only after confirming no in-flight or
-- unresolved commerce mutation requires reconciliation.
DROP TABLE IF EXISTS "CommerceMutation";
