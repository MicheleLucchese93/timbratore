-- Centro Paghe ("ORARIO"/TRORAPRO) export support.
--
-- Adds the payroll anagrafica fields the fixed-width tracciato requires but the
-- app never modelled, plus the per-tenant export configuration:
--   * tenants.codice_ditta             — 7-char company code (CODICE DITTA),
--                                         must match the payroll anagrafica
--   * tenants.cp_code_len              — 2 (single-page LUL) or 4 (full mnemonic)
--   * tenants.cp_donazione_cf          — CF/P.IVA of the blood-collection centre
--                                         (donazione sangue rows, record type 2)
--   * tenants.cp_giustificativo_map    — internal leave kind → CP INP code
--                                         overrides (merged over the defaults)
--   * memberships.codice_fiscale / matricola / inail / qualifica / qualifica2
--                                       — per-employee payroll identity
--
-- Also extends export_jobs.format to allow the new 'centro' format.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS codice_ditta text,
  ADD COLUMN IF NOT EXISTS cp_code_len int NOT NULL DEFAULT 4 CHECK (cp_code_len IN (2, 4)),
  ADD COLUMN IF NOT EXISTS cp_donazione_cf text,
  ADD COLUMN IF NOT EXISTS cp_giustificativo_map jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS codice_fiscale text,
  ADD COLUMN IF NOT EXISTS matricola text,
  ADD COLUMN IF NOT EXISTS inail text,
  ADD COLUMN IF NOT EXISTS qualifica text,
  ADD COLUMN IF NOT EXISTS qualifica2 text;

-- Rewrite the export_jobs.format CHECK in place to admit 'centro'.
ALTER TABLE export_jobs
  DROP CONSTRAINT IF EXISTS export_jobs_format_check;
ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_format_check
    CHECK (format IN ('xlsx', 'json', 'centro'));
