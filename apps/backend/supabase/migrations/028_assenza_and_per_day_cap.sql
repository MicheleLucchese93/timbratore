-- Add 'assenza' as a fourth leave type alongside ferie / permessi / malattia.
--
-- An 'assenza' covers Italian leave categories that do not consume a holiday
-- (ferie) or short-leave (permessi) quota: bereavement (lutto), blood donation
-- (donazione sangue), study leave (permesso studio), wedding (matrimonio),
-- parental leave, Law 104 (assistenza disabili), union assemblies, medical
-- visits, voting (elettorale), nursing (allattamento), personal reasons.
--
-- Each assenza row carries a free-text subtype identifier, a paid/unpaid
-- flag (CCNL- and category-dependent), and a non-empty user_note as the
-- mandatory justification (HR audit).
--
-- The leave_requests.type CHECK is rewritten in place: Postgres lets us
-- drop+add a check constraint atomically inside a single ALTER statement.
ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_type_check;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_type_check
    CHECK (type IN ('ferie','permessi','malattia','assenza'));

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS assenza_subtype text,
  ADD COLUMN IF NOT EXISTS is_paid boolean;

-- assenza rows must carry subtype + paid flag + a non-empty justification.
-- Existing types are unaffected (subtype/is_paid stay NULL).
ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_assenza_fields;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_assenza_fields CHECK (
    type <> 'assenza' OR (
      assenza_subtype IS NOT NULL
      AND length(assenza_subtype) > 0
      AND is_paid IS NOT NULL
      AND user_note IS NOT NULL
      AND length(user_note) > 0
    )
  );

-- Recommended subtype values (informational — the column stays free-text so
-- tenants can extend later without a schema migration):
--   lutto, donazione_sangue, permesso_studio, permesso_elettorale,
--   matrimonio, allattamento, congedo_parentale, legge_104,
--   assemblea_sindacale, visita_medica, motivi_personali
