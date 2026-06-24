-- Partner console: a human-friendly reseller name + free-text notes.
--   partnership_members.partner_name — display label for the reseller (e.g.
--     "Ideal Copy"), distinct from the contact person's first/last name. Shown in
--     the Partner list and used in place of the email in the Aziende owner column.
--   partnership_members.note        — admin's free-text note about the partner.
--   tenants.partner_note            — partner-console note about the company
--     (namespaced so it never collides with any future tenant-facing field).
-- All additive + nullable: existing rows are unaffected.
ALTER TABLE partnership_members ADD COLUMN IF NOT EXISTS partner_name text;
ALTER TABLE partnership_members ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS partner_note text;

-- New audit actions: editing a partner's profile (name/note) and a tenant's note.
ALTER TABLE partnership_audit_log DROP CONSTRAINT IF EXISTS partnership_audit_log_action_check;
ALTER TABLE partnership_audit_log
  ADD CONSTRAINT partnership_audit_log_action_check CHECK (action IN (
    'tenant.create', 'tenant.update_limits', 'tenant.suspend',
    'tenant.resume', 'tenant.admin_reinvite', 'tenant.change_admin',
    'tenant.add_admin', 'tenant.remove_admin', 'tenant.assign_partner',
    'tenant.update_note',
    'partner.create', 'partner.update_caps', 'partner.update_profile',
    'partner.activate', 'partner.deactivate', 'partner.resend'));
