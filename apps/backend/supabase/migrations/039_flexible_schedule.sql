-- Orario flessibile (flextime) + per-weekday auto-deduct lunch.
--
-- Two independent features, both default-off so existing templates behave
-- exactly as before:
--
-- A) flexible_enabled flips a template from fixed-span to flextime:
--      * entry/exit windows widen by flex_in_*/flex_out_* before raising
--        late_clock_in / early_clock_out. The existing tolerance_*_min still
--        applies as the final grace past the flexed anchor (nested bands).
--      * overtime + shortfall are measured against total WORKED duration
--        (Σ fasce), not the clock-end — so arriving late within the window and
--        leaving correspondingly late is neither short nor overtime.
--      * flex_lunch_* widen the allowed window for a split-shift lunch (the gap
--        between two fasce); a lunch stamped outside it raises
--        lunch_outside_window. Lunch DURATION still uses expected_lunch_*.
--
-- B) shift_template_day_lunch: per-weekday "lunch amount without splitting the
--    slot". One continuous fascia (e.g. 09:00–17:30) + a fixed lunch the worker
--    takes whenever, never stamped: worked = presence − lunch_min. Absence of a
--    row for a (template, day) = no auto-lunch that day.

ALTER TABLE shift_templates
  ADD COLUMN IF NOT EXISTS flexible_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flex_in_before_min int NOT NULL DEFAULT 0
    CHECK (flex_in_before_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS flex_in_after_min int NOT NULL DEFAULT 0
    CHECK (flex_in_after_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS flex_out_before_min int NOT NULL DEFAULT 0
    CHECK (flex_out_before_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS flex_out_after_min int NOT NULL DEFAULT 0
    CHECK (flex_out_after_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS flex_lunch_before_min int NOT NULL DEFAULT 0
    CHECK (flex_lunch_before_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS flex_lunch_after_min int NOT NULL DEFAULT 0
    CHECK (flex_lunch_after_min BETWEEN 0 AND 240);

CREATE TABLE IF NOT EXISTS shift_template_day_lunch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_template_id uuid NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  -- ISO day-of-week: 1=Mon ... 7=Sun (matches shift_template_slots).
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  lunch_min int NOT NULL CHECK (lunch_min BETWEEN 0 AND 480),
  CONSTRAINT shift_template_day_lunch_unique UNIQUE (shift_template_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS shift_template_day_lunch_template_idx
  ON shift_template_day_lunch(shift_template_id);
CREATE INDEX IF NOT EXISTS shift_template_day_lunch_tenant_idx
  ON shift_template_day_lunch(tenant_id);

ALTER TABLE shift_template_day_lunch ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shift_template_day_lunch' AND policyname='shift_template_day_lunch_tenant_iso') THEN
    CREATE POLICY shift_template_day_lunch_tenant_iso ON shift_template_day_lunch
      FOR ALL TO PUBLIC
      USING (tenant_id = auth.tenant_id())
      WITH CHECK (tenant_id = auth.tenant_id());
  END IF;
END $$;
