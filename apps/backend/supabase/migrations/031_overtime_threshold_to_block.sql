-- Overtime threshold semantics change: extraordinary_threshold_min is now a
-- BLOCK SIZE, not a grace window. Surplus past the expected end is counted in
-- whole blocks of this many minutes; a partial block is not counted (e.g. with
-- a 30-min block, 28 min past expected end → 0 overtime; with 15 min → 15).
--
-- Allowed values change from (1, 15, 30) to (15, 30, 60). Any existing row on
-- the dropped value 1 (or any out-of-range value) is migrated to 15.

ALTER TABLE shift_templates
  DROP CONSTRAINT IF EXISTS shift_templates_extraordinary_threshold_min_check;

UPDATE shift_templates
  SET extraordinary_threshold_min = 15
  WHERE extraordinary_threshold_min NOT IN (15, 30, 60);

ALTER TABLE shift_templates
  ADD CONSTRAINT shift_templates_extraordinary_threshold_min_check
    CHECK (extraordinary_threshold_min IN (15, 30, 60));
