-- Read-only convenience views that surface `email` alongside every *_user_id
-- column. Lets ad-hoc psql / Adminer browsing answer "who is this user?"
-- without a manual JOIN to auth.users.
--
-- Each view ends with `_v`, exposes all columns of the underlying table, and
-- adds one email column per user-id reference (named *_email; bare `email`
-- when there is a single canonical user_id). Underlying tables are unchanged.
--
-- WITH (security_invoker = true) makes the view run as the calling role, so
-- RLS policies on the underlying tables still gate access for the `app` role.
-- Requires PostgreSQL >= 15.

/* ---------------- memberships, branch_memberships, audit_log ---------------- */

CREATE OR REPLACE VIEW public.memberships_v
WITH (security_invoker = true) AS
SELECT m.*, u.email
FROM memberships m
LEFT JOIN public.auth_users_view u ON u.id = m.user_id;

CREATE OR REPLACE VIEW public.branch_memberships_v
WITH (security_invoker = true) AS
SELECT bm.*, u.email
FROM branch_memberships bm
LEFT JOIN public.auth_users_view u ON u.id = bm.user_id;

CREATE OR REPLACE VIEW public.audit_log_v
WITH (security_invoker = true) AS
SELECT al.*, u.email AS actor_email
FROM audit_log al
LEFT JOIN public.auth_users_view u ON u.id = al.actor_user_id;

/* ---------------- stamps ---------------- */

CREATE OR REPLACE VIEW public.stamps_v
WITH (security_invoker = true) AS
SELECT s.*,
       u.email  AS user_email,
       du.email AS deleted_by_email
FROM stamps s
LEFT JOIN public.auth_users_view u  ON u.id  = s.user_id
LEFT JOIN public.auth_users_view du ON du.id = s.deleted_by_user_id;

CREATE OR REPLACE VIEW public.stamps_history_v
WITH (security_invoker = true) AS
SELECT sh.*, u.email AS changed_by_email
FROM stamps_history sh
LEFT JOIN public.auth_users_view u ON u.id = sh.changed_by;

/* ---------------- corrections ---------------- */

CREATE OR REPLACE VIEW public.correction_requests_v
WITH (security_invoker = true) AS
SELECT cr.*,
       u.email  AS user_email,
       ru.email AS resolved_by_email
FROM correction_requests cr
LEFT JOIN public.auth_users_view u  ON u.id  = cr.user_id
LEFT JOIN public.auth_users_view ru ON ru.id = cr.resolved_by;

CREATE OR REPLACE VIEW public.correction_approvers_v
WITH (security_invoker = true) AS
SELECT ca.*,
       u.email  AS user_email,
       au.email AS approver_email
FROM correction_approvers ca
LEFT JOIN public.auth_users_view u  ON u.id  = ca.user_id
LEFT JOIN public.auth_users_view au ON au.id = ca.approver_user_id;

/* ---------------- shifts ---------------- */

CREATE OR REPLACE VIEW public.user_shift_assignments_v
WITH (security_invoker = true) AS
SELECT usa.*, u.email
FROM user_shift_assignments usa
LEFT JOIN public.auth_users_view u ON u.id = usa.user_id;

/* ---------------- leaves ---------------- */

CREATE OR REPLACE VIEW public.leave_quota_assignments_v
WITH (security_invoker = true) AS
SELECT lqa.*,
       u.email  AS user_email,
       cu.email AS created_by_email
FROM leave_quota_assignments lqa
LEFT JOIN public.auth_users_view u  ON u.id  = lqa.user_id
LEFT JOIN public.auth_users_view cu ON cu.id = lqa.created_by;

CREATE OR REPLACE VIEW public.leave_approvers_v
WITH (security_invoker = true) AS
SELECT la.*,
       u.email  AS user_email,
       au.email AS approver_email
FROM leave_approvers la
LEFT JOIN public.auth_users_view u  ON u.id  = la.user_id
LEFT JOIN public.auth_users_view au ON au.id = la.approver_user_id;

CREATE OR REPLACE VIEW public.leave_requests_v
WITH (security_invoker = true) AS
SELECT lr.*,
       u.email  AS user_email,
       du.email AS decided_by_email,
       cu.email AS cancellation_decided_by_email
FROM leave_requests lr
LEFT JOIN public.auth_users_view u  ON u.id  = lr.user_id
LEFT JOIN public.auth_users_view du ON du.id = lr.decided_by
LEFT JOIN public.auth_users_view cu ON cu.id = lr.cancellation_decided_by;

CREATE OR REPLACE VIEW public.leave_audit_log_v
WITH (security_invoker = true) AS
SELECT lal.*, u.email AS actor_email
FROM leave_audit_log lal
LEFT JOIN public.auth_users_view u ON u.id = lal.actor_user_id;

CREATE OR REPLACE VIEW public.leave_accruals_v
WITH (security_invoker = true) AS
SELECT la.*,
       u.email  AS user_email,
       cu.email AS created_by_email
FROM leave_accruals la
LEFT JOIN public.auth_users_view u  ON u.id  = la.user_id
LEFT JOIN public.auth_users_view cu ON cu.id = la.created_by;

/* ---------------- grants ---------------- */

GRANT SELECT ON public.memberships_v             TO app, sonoqui_owner;
GRANT SELECT ON public.branch_memberships_v      TO app, sonoqui_owner;
GRANT SELECT ON public.audit_log_v               TO app, sonoqui_owner;
GRANT SELECT ON public.stamps_v                  TO app, sonoqui_owner;
GRANT SELECT ON public.stamps_history_v          TO app, sonoqui_owner;
GRANT SELECT ON public.correction_requests_v     TO app, sonoqui_owner;
GRANT SELECT ON public.correction_approvers_v    TO app, sonoqui_owner;
GRANT SELECT ON public.user_shift_assignments_v  TO app, sonoqui_owner;
GRANT SELECT ON public.leave_quota_assignments_v TO app, sonoqui_owner;
GRANT SELECT ON public.leave_approvers_v         TO app, sonoqui_owner;
GRANT SELECT ON public.leave_requests_v          TO app, sonoqui_owner;
GRANT SELECT ON public.leave_audit_log_v         TO app, sonoqui_owner;
GRANT SELECT ON public.leave_accruals_v          TO app, sonoqui_owner;
