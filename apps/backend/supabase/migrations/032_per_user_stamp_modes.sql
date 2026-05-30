-- Per-user stamping methods. Replaces the single boolean
-- memberships.disable_desktop_clock_in with a set of allowed clock-in modes:
--   'gps'    → mobile clock-in, geofence enforced (today's default behaviour)
--   'remote' → web/desktop clock-in, NO geofence (was disable_desktop_clock_in = false)
-- An empty array means the user cannot clock in at all (new capability).
-- 'wifi' is reserved for a future feature (see Specs/WIFI_STAMPING.md) and is
-- intentionally NOT permitted by the CHECK constraint until it is implemented.

ALTER TABLE memberships
  ADD COLUMN stamp_modes text[] NOT NULL DEFAULT ARRAY['gps'];

-- Backfill: every user could clock in on mobile (GPS) before. Users who also had
-- desktop clock-in enabled (disable_desktop_clock_in = false) additionally get 'remote'.
UPDATE memberships
  SET stamp_modes = CASE
    WHEN disable_desktop_clock_in THEN ARRAY['gps']
    ELSE ARRAY['gps', 'remote']
  END;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_stamp_modes_check
    CHECK (stamp_modes <@ ARRAY['gps', 'remote']::text[]);

ALTER TABLE memberships
  DROP COLUMN disable_desktop_clock_in;
