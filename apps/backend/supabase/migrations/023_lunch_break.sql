-- Add lunch_start/lunch_end stamp events + per-shift lunch tolerance window.
--
-- Pausa pranzo is a second break category, semantically identical to pausa but
-- with its own min/max anomaly thresholds. Paid/unpaid still derives from the
-- 30-min duration rule in export-service.ts. Workers may take at most one open
-- break of any type at a time (state machine enforces).

ALTER TABLE stamps DROP CONSTRAINT IF EXISTS stamps_event_type_check;
ALTER TABLE stamps ADD CONSTRAINT stamps_event_type_check
  CHECK (event_type IN ('clock_in','clock_out','break_start','break_end','lunch_start','lunch_end'));

ALTER TABLE shift_templates
  ADD COLUMN IF NOT EXISTS expected_lunch_min_min int NOT NULL DEFAULT 0
    CHECK (expected_lunch_min_min BETWEEN 0 AND 480),
  ADD COLUMN IF NOT EXISTS expected_lunch_max_min int NOT NULL DEFAULT 90
    CHECK (expected_lunch_max_min BETWEEN 0 AND 480);

ALTER TABLE shift_templates DROP CONSTRAINT IF EXISTS shift_templates_lunch_window;
ALTER TABLE shift_templates ADD CONSTRAINT shift_templates_lunch_window
  CHECK (expected_lunch_min_min <= expected_lunch_max_min);
