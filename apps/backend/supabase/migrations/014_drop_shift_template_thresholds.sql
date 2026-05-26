-- Drop payroll thresholds from shift_templates. Logic moves to code-level defaults
-- (export-service uses 30 min paid-break, forgotten-clockout uses 14h max shift).

ALTER TABLE shift_templates
  DROP COLUMN IF EXISTS paid_break_threshold_min,
  DROP COLUMN IF EXISTS max_shift_hours;
