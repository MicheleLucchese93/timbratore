-- Surface GoTrue-registered users in the `public` schema so Adminer (and any
-- tooling that browses `public`) shows them without having to switch schemas.
--
-- Penno keeps GoTrue tables in `public` directly; sonoqui keeps them in the
-- `auth` schema (cleaner separation) and uses `public.auth_users` as a
-- lightweight app-side mirror. This view bridges the two: read-only, safe
-- columns only (no password hash, no reset/confirmation tokens).

CREATE OR REPLACE VIEW public.auth_users_view AS
SELECT
  u.id,
  u.email,
  u.aud,
  u.role,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.created_at,
  u.updated_at,
  u.invited_at,
  u.banned_until,
  u.deleted_at,
  u.is_anonymous,
  u.raw_app_meta_data,
  u.raw_user_meta_data
FROM auth.users u;

GRANT SELECT ON public.auth_users_view TO sonoqui_owner;
GRANT SELECT ON public.auth_users_view TO app;
