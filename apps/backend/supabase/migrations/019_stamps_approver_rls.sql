-- Allow configured correction-request approvers to read and write stamps of
-- the users they approve. Required by the new approver workflow added in
-- migration 018: when a non-admin approver decides a correction, the API
-- inserts (missing stamp) or updates (existing stamp) on the requester's
-- behalf, and RETURNING forces a visibility check via the SELECT USING clause.
--
-- Authorisation is still gated at the API layer (assertCanDecide): RLS only
-- needs to permit the access pattern, not enforce policy.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stamps' AND policyname='stamps_tenant_iso') THEN
    DROP POLICY stamps_tenant_iso ON stamps;
  END IF;
  CREATE POLICY stamps_tenant_iso ON stamps
    FOR ALL TO PUBLIC
    USING (
      tenant_id = auth.tenant_id()
      AND (
        auth.is_admin()
        OR user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM correction_approvers ca
           WHERE ca.user_id = stamps.user_id
             AND ca.approver_user_id = auth.uid()
        )
      )
    )
    WITH CHECK (tenant_id = auth.tenant_id());
END $$;
