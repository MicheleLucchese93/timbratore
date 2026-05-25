-- (NO-OP) Production uses a dedicated non-superuser app role; FORCE RLS
-- is unnecessary there. In local dev the superuser bypasses by default,
-- so we connect via the dedicated sonoqui_app role created in setup.
SELECT 1;
