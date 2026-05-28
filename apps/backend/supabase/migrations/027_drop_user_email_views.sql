-- Revert 026_user_email_views.sql — drop the *_v convenience views.

DROP VIEW IF EXISTS public.memberships_v;
DROP VIEW IF EXISTS public.branch_memberships_v;
DROP VIEW IF EXISTS public.audit_log_v;
DROP VIEW IF EXISTS public.stamps_v;
DROP VIEW IF EXISTS public.stamps_history_v;
DROP VIEW IF EXISTS public.correction_requests_v;
DROP VIEW IF EXISTS public.correction_approvers_v;
DROP VIEW IF EXISTS public.user_shift_assignments_v;
DROP VIEW IF EXISTS public.leave_quota_assignments_v;
DROP VIEW IF EXISTS public.leave_approvers_v;
DROP VIEW IF EXISTS public.leave_requests_v;
DROP VIEW IF EXISTS public.leave_audit_log_v;
DROP VIEW IF EXISTS public.leave_accruals_v;
