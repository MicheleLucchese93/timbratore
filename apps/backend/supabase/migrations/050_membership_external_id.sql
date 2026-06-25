-- Per-employee "Identificativo univoco" (unique identifier): an optional,
-- free-text business identifier for a membership (e.g. badge number, internal
-- HR code). Stored on the membership row next to the Centro Paghe anagrafica
-- (migration 040). Nullable and unconstrained — same precedent as `matricola`:
-- the admin owns its uniqueness; the app does not enforce a DB constraint so
-- imports/edits never fail on it.
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS external_id text;
