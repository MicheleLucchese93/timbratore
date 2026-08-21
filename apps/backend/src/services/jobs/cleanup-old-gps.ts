import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('cleanup_old_gps');

/**
 * Reaper for per-punch GPS coordinates that should not exist.
 *
 * The API stopped writing latitude/longitude/gps_accuracy_m entirely: the
 * geofence check consumes the reading and only its verdict is stored
 * (branch_id, out_of_geofence, geofence_distance_m). Migration 060 nulled the
 * rows that predate that change, so a non-NULL coordinate now means a bug or a
 * write path nobody reviewed — hence no age window. It used to keep coordinates
 * for 90 days, which also meant the UPDATE fired stamps_history_trigger and
 * archived, in an append-only table, exactly the coordinates it had just erased.
 *
 * That is why the pass is gated on migration 060 having been applied. Deploys
 * here are two independent steps (deploy.sh only pulls and rebuilds the image;
 * migrations are run by hand), so this code can be live while the database is
 * still on 059 — and 059's trigger archives whole-row snapshots. Stripping
 * coordinates against that trigger would write one permanent history row per
 * legacy punch: the exact self-defeating behaviour 060 exists to end. Skipping
 * costs nothing, since the same pass will run once the migration lands.
 */
export async function cleanupOldGps(): Promise<void> {
  const migrated = await adminPool.query(
    `SELECT 1 FROM pg_proc WHERE proname = 'stamps_gps_stripped'`
  );
  if (migrated.rowCount === 0) {
    logger.warn('migration 060 not applied yet — skipping (the history trigger would archive what this strips)');
    return;
  }
  const r = await adminPool.query(
    `UPDATE stamps
     SET latitude = NULL, longitude = NULL, gps_accuracy_m = NULL
     WHERE latitude IS NOT NULL
        OR longitude IS NOT NULL
        OR gps_accuracy_m IS NOT NULL`
  );
  if (r.rowCount) {
    logger.warn({ rows: r.rowCount }, 'stripped GPS that should never have been stored');
  }
}
