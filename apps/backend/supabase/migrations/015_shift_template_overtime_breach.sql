-- Extend shift_templates with overtime grace + tolerance-breach payroll deductions.
--
-- extraordinary_threshold_min  : minutes of grace past expected end before any
--                                surplus counts as overtime. Constrained to
--                                1, 15 or 30 minutes per product spec.
-- count_extraordinary          : when false, overtime is never recorded even
--                                if surplus exceeds the threshold.
-- tolerance_in_breach_deduct_min  : minutes subtracted from the day's worked
--                                   time when clock-in lands past
--                                   (expected_start + tolerance_in_min).
-- tolerance_out_breach_deduct_min : same for early clock-out beyond
--                                   tolerance_out_min.
-- tolerance_break_breach_deduct_min : same for breaks longer than
--                                     expected_break_max_min.

ALTER TABLE shift_templates
  ADD COLUMN IF NOT EXISTS extraordinary_threshold_min int NOT NULL DEFAULT 15
    CHECK (extraordinary_threshold_min IN (1, 15, 30)),
  ADD COLUMN IF NOT EXISTS count_extraordinary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tolerance_in_breach_deduct_min int NOT NULL DEFAULT 0
    CHECK (tolerance_in_breach_deduct_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS tolerance_out_breach_deduct_min int NOT NULL DEFAULT 0
    CHECK (tolerance_out_breach_deduct_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS tolerance_break_breach_deduct_min int NOT NULL DEFAULT 0
    CHECK (tolerance_break_breach_deduct_min BETWEEN 0 AND 240);
