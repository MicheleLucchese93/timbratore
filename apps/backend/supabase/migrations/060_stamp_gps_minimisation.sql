-- Per-punch GPS minimisation.
--
-- A punch needs its geofence verdict, not its coordinates. The verdict is
-- computed once, at insert time, and persisted as branch_id / out_of_geofence /
-- geofence_distance_m; the raw latitude/longitude have no remaining use after
-- that. The Garante asks for exactly this outcome — keep "soltanto sede, data e
-- ora" once the check is done (provv. 8 settembre 2016 n. 350), and the
-- proportionality test in Trib. Cosenza 972/2026 turns on the same point.
--
-- Nulling stamps.latitude/longitude was never enough on its own, because copies
-- of the same coordinates live outside that row:
--
--   * stamps_history archives to_jsonb(OLD)/to_jsonb(NEW) of every punch, and
--     the table is append-only (007_rls_policy_fixes.sql REVOKEs UPDATE/DELETE
--     from PUBLIC). The nightly cleanup_old_gps UPDATE therefore fired this
--     trigger and copied the coordinates it had just erased into a fresh
--     history row — the retention job was preserving what it was meant to
--     delete, every night, since the job was written.
--   * centrifugo_outbox embedded the whole inserted stamps row in the dashboard
--     publish payload, and that table has no retention at all.
--   * audit_log carries before/after whole-row snapshots for stamp.admin_update
--     and stamp.admin_delete, and has no retention either.
--   * idempotency_keys cached the POST /stamps response body for 24h.
--
-- The trigger is replaced FIRST so that nothing below re-archives what it
-- deletes. Branch/sede coordinates are company configuration, not personal
-- data, and are deliberately left alone everywhere in this migration.

/* ---------- 0. shared helper ---------- */

-- Strips the three per-punch GPS keys from a whole-row jsonb snapshot. The
-- explicit text[] cast picks the `jsonb - text[]` operator; a bare string
-- literal would leave the choice between `- text` and `- text[]` to inference.
CREATE OR REPLACE FUNCTION stamps_gps_stripped(j jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
             WHEN j IS NULL THEN NULL
             ELSE j - ARRAY['latitude', 'longitude', 'gps_accuracy_m']::text[]
           END
  $$;

/* ---------- 1. stop the history trigger from archiving coordinates ---------- */

CREATE OR REPLACE FUNCTION trg_stamps_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reason text := NULLIF(current_setting('app.change_reason', true), '');
  actor uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO stamps_history(stamp_id, tenant_id, user_id, operation, changed_by, change_reason, before, after)
    VALUES (NEW.id, NEW.tenant_id, NEW.user_id, 'INSERT', actor, reason, NULL, stamps_gps_stripped(to_jsonb(NEW)));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO stamps_history(stamp_id, tenant_id, user_id, operation, changed_by, change_reason, before, after)
    VALUES (NEW.id, NEW.tenant_id, NEW.user_id, 'UPDATE', actor, reason,
            stamps_gps_stripped(to_jsonb(OLD)), stamps_gps_stripped(to_jsonb(NEW)));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO stamps_history(stamp_id, tenant_id, user_id, operation, changed_by, change_reason, before, after)
    VALUES (OLD.id, OLD.tenant_id, OLD.user_id, 'DELETE', actor, reason,
            stamps_gps_stripped(to_jsonb(OLD)), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

/* ---------- 2. scrub the snapshots already archived ---------- */

UPDATE stamps_history
   SET before = stamps_gps_stripped(before),
       after  = stamps_gps_stripped(after)
 WHERE before ?| ARRAY['latitude', 'longitude', 'gps_accuracy_m']
    OR after  ?| ARRAY['latitude', 'longitude', 'gps_accuracy_m'];

/* ---------- 3. scrub the Registro attività ---------- */

-- Scoped to stamp.* on purpose: branch.create / branch.update legitimately
-- audit a sede's latitude/longitude, and "the sede moved" is exactly the kind of
-- change the Registro exists to show.
UPDATE audit_log
   SET before = stamps_gps_stripped(before),
       after  = stamps_gps_stripped(after)
 WHERE action LIKE 'stamp.%'
   AND (before ?| ARRAY['latitude', 'longitude', 'gps_accuracy_m']
     OR after  ?| ARRAY['latitude', 'longitude', 'gps_accuracy_m']);

/* ---------- 4. scrub the realtime outbox ---------- */

UPDATE centrifugo_outbox
   SET payload = jsonb_set(payload, '{data,stamp}',
                           stamps_gps_stripped(payload -> 'data' -> 'stamp'))
 WHERE payload -> 'data' ->> 'type' = 'stamp'
   AND payload -> 'data' -> 'stamp' ?| ARRAY['latitude', 'longitude', 'gps_accuracy_m'];

/* ---------- 5. drop the cached POST /stamps response bodies ---------- */

DELETE FROM idempotency_keys WHERE scope = 'stamp_create';

/* ---------- 6. drop the coordinates still on the stamps rows ---------- */

-- Irreversible, and meant to be: from this migration on the API never writes
-- these columns (the geofence verdict is persisted instead), so anything still
-- here is legacy data the tenant has no lawful reason to keep. The trigger is
-- suspended for the pass so the scrub does not write one history row per punch
-- that ever existed — same technique as 059_stamp_edit_provenance.sql.
ALTER TABLE stamps DISABLE TRIGGER stamps_history_trigger;

UPDATE stamps
   SET latitude = NULL, longitude = NULL, gps_accuracy_m = NULL
 WHERE latitude IS NOT NULL
    OR longitude IS NOT NULL
    OR gps_accuracy_m IS NOT NULL;

ALTER TABLE stamps ENABLE TRIGGER stamps_history_trigger;

-- The columns themselves stay. Dropping them would break every deployed client
-- and every SELECT that still names them, for no privacy gain over holding them
-- permanently NULL.
COMMENT ON COLUMN stamps.latitude IS
  'Always NULL from migration 060. The geofence verdict is kept in branch_id / out_of_geofence / geofence_distance_m instead; raw coordinates are discarded after the check (Garante provv. 350/2016).';
COMMENT ON COLUMN stamps.longitude IS 'Always NULL from migration 060 — see stamps.latitude.';
COMMENT ON COLUMN stamps.gps_accuracy_m IS 'Always NULL from migration 060 — see stamps.latitude.';
