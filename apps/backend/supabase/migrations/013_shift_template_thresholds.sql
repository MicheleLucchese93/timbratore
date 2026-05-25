-- Move payroll/operational thresholds from tenant level to per-shift_template level.
-- Rationale: with named work schedules ("orari di lavoro"), different roles
-- can have different paid-break thresholds and maximum shift durations.

ALTER TABLE shift_templates
  ADD COLUMN IF NOT EXISTS paid_break_threshold_min int NOT NULL DEFAULT 30
    CHECK (paid_break_threshold_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS max_shift_hours int NOT NULL DEFAULT 14
    CHECK (max_shift_hours BETWEEN 4 AND 24);

ALTER TABLE tenants
  DROP COLUMN IF EXISTS break_paid_threshold_min,
  DROP COLUMN IF EXISTS max_shift_hours,
  DROP COLUMN IF EXISTS max_break_hours;
