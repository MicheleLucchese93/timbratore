-- Widen the partnership_audit_log.action CHECK to cover two new operations:
-- changing a tenant's admin email, and resending a partner's invite.
ALTER TABLE partnership_audit_log DROP CONSTRAINT IF EXISTS partnership_audit_log_action_check;
ALTER TABLE partnership_audit_log
  ADD CONSTRAINT partnership_audit_log_action_check CHECK (action IN (
    'tenant.create', 'tenant.update_limits', 'tenant.suspend',
    'tenant.resume', 'tenant.admin_reinvite', 'tenant.change_admin',
    'partner.create', 'partner.update_caps',
    'partner.activate', 'partner.deactivate', 'partner.resend'));
