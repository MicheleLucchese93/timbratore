// "Dossier giornata": everything that can be said about one employee's one day.
//
// A contestation is never about a single row — it is about a day: what the
// employee punched, what the admin changed and why, which anomaly was
// justified with what note, and whether a correction request was involved.
// Assembling that in the client would mean four round trips and a client-side
// join that the PDF could not reuse, so it is assembled once here.
import type { PoolClient } from 'pg';
import { TENANT_TZ_SQL } from './tz.js';
import { loadStampHistories, type StampHistoryEvent } from './stamp-history.js';

export interface DossierStamp {
  id: string;
  event_type: string;
  occurred_at: string;
  source: string;
  branch_id: string | null;
  branch_name: string | null;
  notes: string | null;
  created_at: string;
  device_platform: string | null;
  device_app_version: string | null;
  suspicious_mock_location: boolean;
  out_of_geofence: boolean;
  original_occurred_at: string | null;
  original_event_type: string | null;
  edited_at: string | null;
  edit_count: number;
  edited_by_name: string | null;
  deleted_at: string | null;
  deletion_reason: string | null;
  deleted_by_name: string | null;
  history: StampHistoryEvent[];
}

export interface DossierJustification {
  anomaly_kind: string;
  note: string;
  created_at: string;
  created_by_name: string | null;
}

export interface DossierCorrection {
  id: string;
  claimed_event_type: string;
  claimed_occurred_at: string;
  justification: string;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  created_at: string;
}

export interface DayDossier {
  date: string;
  tenant_name: string;
  user: {
    user_id: string;
    name: string;
    email: string | null;
    external_id: string | null;
  };
  stamps: DossierStamp[];
  justifications: DossierJustification[];
  corrections: DossierCorrection[];
  generated_at: string;
  generated_by: string | null;
}

const NAME_SQL = (alias: string): string =>
  `COALESCE(NULLIF(TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), ''), ${alias}.display_name, ${alias}.email)`;

function iso(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Build the dossier for (user, tenant-local date). Runs entirely on the
 * caller's tenant client, so RLS decides what is visible: an admin sees any
 * member, an employee only themselves.
 */
export async function loadDayDossier(
  client: PoolClient,
  opts: { userId: string; date: string; generatedBy?: string | null }
): Promise<DayDossier> {
  const { userId, date } = opts;

  // Soft-deleted punches are the whole point — a deleted punch is exactly the
  // one a dispute is about — so no deleted_at filter here. A punch whose time
  // was MOVED off this day is included too: from the employee's side the event
  // still belongs to the day they originally stamped.
  // Every query below runs on the SAME pooled client inside tenantHandler's
  // RLS transaction: a client executes one query at a time, so they are awaited
  // in sequence (Promise.all would only earn the pg@8 deprecation warning).
  const stampsR = await client.query(
    `SELECT s.id, s.event_type, s.occurred_at, s.source, s.branch_id, b.name AS branch_name,
            s.notes, s.created_at, s.device_platform, s.device_app_version,
            s.suspicious_mock_location, s.out_of_geofence,
            s.original_occurred_at, s.original_event_type, s.edited_at, s.edit_count,
            ${NAME_SQL('eu')} AS edited_by_name,
            s.deleted_at, s.deletion_reason, ${NAME_SQL('du')} AS deleted_by_name
       FROM stamps s
       LEFT JOIN branches b   ON b.id = s.branch_id
       LEFT JOIN auth_users eu ON eu.id = s.edited_by_user_id
       LEFT JOIN auth_users du ON du.id = s.deleted_by_user_id
      WHERE s.user_id = $1
        AND (
          (s.occurred_at >= ($2::timestamp AT TIME ZONE ${TENANT_TZ_SQL})
           AND s.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE ${TENANT_TZ_SQL}))
          OR
          (s.original_occurred_at >= ($2::timestamp AT TIME ZONE ${TENANT_TZ_SQL})
           AND s.original_occurred_at < (($2::date + 1)::timestamp AT TIME ZONE ${TENANT_TZ_SQL}))
        )
      ORDER BY s.occurred_at`,
    [userId, `${date} 00:00:00`]
  );

  const userR = await client.query(
    `SELECT m.user_id, m.external_id, au.email, ${NAME_SQL('au')} AS name
       FROM memberships m
       LEFT JOIN auth_users au ON au.id = m.user_id
      WHERE m.tenant_id = current_setting('app.current_tenant_id')::uuid
        AND m.user_id = $1`,
    [userId]
  );

  const tenantR = await client.query(
    `SELECT ragione_sociale FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid`
  );

  const justificationsR = await client.query(
    `SELECT j.anomaly_kind, j.note, j.created_at, ${NAME_SQL('au')} AS created_by_name
       FROM anomaly_justifications j
       LEFT JOIN auth_users au ON au.id = j.created_by
      WHERE j.user_id = $1 AND j.anomaly_date = $2::date
      ORDER BY j.anomaly_kind`,
    [userId, date]
  );

  const correctionsR = await client.query(
    `SELECT c.id, c.claimed_event_type, c.claimed_occurred_at, c.justification, c.status,
            c.resolution_note, c.resolved_at, ${NAME_SQL('au')} AS resolved_by_name, c.created_at
       FROM correction_requests c
       LEFT JOIN auth_users au ON au.id = c.resolved_by
      WHERE c.user_id = $1
        AND c.claimed_occurred_at >= ($2::timestamp AT TIME ZONE ${TENANT_TZ_SQL})
        AND c.claimed_occurred_at <  (($2::date + 1)::timestamp AT TIME ZONE ${TENANT_TZ_SQL})
      ORDER BY c.claimed_occurred_at`,
    [userId, `${date} 00:00:00`]
  );

  const ids = stampsR.rows.map((r) => r.id as string);
  const histories = await loadStampHistories(client, ids);

  const stamps: DossierStamp[] = stampsR.rows.map((r) => ({
    id: r.id,
    event_type: r.event_type,
    occurred_at: iso(r.occurred_at)!,
    source: r.source,
    branch_id: r.branch_id,
    branch_name: r.branch_name,
    notes: r.notes,
    created_at: iso(r.created_at)!,
    device_platform: r.device_platform,
    device_app_version: r.device_app_version,
    suspicious_mock_location: r.suspicious_mock_location,
    out_of_geofence: r.out_of_geofence ?? false,
    original_occurred_at: iso(r.original_occurred_at),
    original_event_type: r.original_event_type,
    edited_at: iso(r.edited_at),
    edit_count: Number(r.edit_count ?? 0),
    edited_by_name: r.edited_by_name,
    deleted_at: iso(r.deleted_at),
    deletion_reason: r.deletion_reason,
    deleted_by_name: r.deleted_by_name,
    history: histories.get(r.id as string) ?? [],
  }));

  const u = userR.rows[0];
  return {
    date,
    tenant_name: (tenantR.rows[0]?.ragione_sociale as string | undefined) ?? '',
    user: {
      user_id: userId,
      name: (u?.name as string | undefined) ?? (u?.email as string | undefined) ?? userId,
      email: (u?.email as string | undefined) ?? null,
      external_id: (u?.external_id as string | undefined) ?? null,
    },
    stamps,
    justifications: justificationsR.rows.map((r) => ({
      anomaly_kind: r.anomaly_kind,
      note: r.note,
      created_at: iso(r.created_at)!,
      created_by_name: r.created_by_name,
    })),
    corrections: correctionsR.rows.map((r) => ({
      id: r.id,
      claimed_event_type: r.claimed_event_type,
      claimed_occurred_at: iso(r.claimed_occurred_at)!,
      justification: r.justification,
      status: r.status,
      resolution_note: r.resolution_note,
      resolved_at: iso(r.resolved_at),
      resolved_by_name: r.resolved_by_name,
      created_at: iso(r.created_at)!,
    })),
    generated_at: new Date().toISOString(),
    generated_by: opts.generatedBy ?? null,
  };
}
