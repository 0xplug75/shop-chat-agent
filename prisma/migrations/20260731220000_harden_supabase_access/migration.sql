-- Supabase installs this event-trigger function to enable RLS automatically.
-- It does not need to be callable through PostgREST by public API roles.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC';

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated';
    END IF;
  END IF;
END
$$;

-- Composite tenant indexes do not cover lookups that start with the foreign key.
CREATE INDEX IF NOT EXISTS "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX IF NOT EXISTS "CustomerToken_conversationId_idx" ON "CustomerToken"("conversationId");
