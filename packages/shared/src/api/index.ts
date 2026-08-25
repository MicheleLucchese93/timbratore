// API module: the scope vocabulary shared by the backend, the web app and the
// generated OpenAPI document.
//
// A scope is `<resource>:<read|write>`. Two levels, not more: the customers who
// integrate are a gestionale, a badge reader and a BI tool, and the question
// they need answered is "may this credential change our data" — a finer lattice
// (per-endpoint grants) buys precision nobody asked for and a settings screen
// nobody can read. The one place that granularity DOES matter is the split
// itself: a nightly BI pull is `*:read` only, and a badge reader gets exactly
// `stamps:write` and nothing else.
//
// WHY THERE IS NO `documents` SCOPE. HR documents (migration 042) are gated
// behind the Documentale capability and a one-time code sent to a human's
// mailbox — that gate exists precisely because a payslip is not ordinary
// company data. A machine credential is, by construction, a way around a code
// sent to a human. So the API does not serve them at all, at any scope. The
// same reasoning keeps `auth`, password changes and the notification token
// store off the surface.
//
// Dependency-free on purpose: consumed as source by the backend (tsc) and the
// web app (Vite) alike.

/** Resources the API exposes, in the order the Settings screen lists them. */
export const API_RESOURCES = [
  'users',
  'branches',
  'stamps',
  'anomalies',
  'corrections',
  'leaves',
  'quotas',
  'shifts',
  'bulletins',
  'cantieri',
  'exports',
  'reports',
  'audit',
] as const;

export type ApiResource = (typeof API_RESOURCES)[number];

/**
 * Resources the API serves READ-ONLY, and why each one is on this list.
 *
 * This is the most important list in the module, because every entry is a
 * deliberate refusal rather than unfinished work:
 *
 *  leaves, corrections — granting an absence or settling a disputed punch is a
 *    DECISION, and `leave_requests.decided_by` / a rettifica's resolver exist to
 *    name the person who made it. A key has no name. The guards behind those
 *    writes (per-day capacity cap, same-type overlap, the quota ledger, an
 *    advisory-lock ordering that exists because getting it wrong once
 *    double-booked a company's ferie) are also one implementation for a reason.
 *  quotas — an accrual is a ledger entry; the residual everyone reads is
 *    derived from it. Machine-written ledger entries with no author are how a
 *    balance stops being reconcilable.
 *  bulletins — a company announcement is addressed FROM somebody, and posting
 *    one fans out email and push to every employee. Read access answers the
 *    useful question ("who has actually opened the safety notice"); writing is
 *    not something to hand a cron job.
 *  cantieri — by construction, not by choice: a site entry may only be filed by
 *    a user assigned to that site, and the DB policy re-checks it. A key is
 *    assigned to nothing, which is the correct answer.
 *  reports, audit — derived surfaces. "Write" is meaningless for an aggregate
 *    and corrupting for an append-only trail: a log an integration can write is
 *    not a log.
 *
 * Everything NOT on this list — users, branches, stamps, anomalies, shifts,
 * exports — is a data transfer or a piece of configuration, which is exactly
 * what a machine should be allowed to do.
 */
export const API_READ_ONLY_RESOURCES: readonly ApiResource[] = [
  'leaves',
  'quotas',
  'corrections',
  'bulletins',
  'cantieri',
  'reports',
  'audit',
];

export type ApiAccess = 'read' | 'write';
export type ApiScope = `${ApiResource}:${ApiAccess}`;

export const API_SCOPES: readonly ApiScope[] = API_RESOURCES.flatMap((r) =>
  API_READ_ONLY_RESOURCES.includes(r)
    ? [`${r}:read` as ApiScope]
    : [`${r}:read` as ApiScope, `${r}:write` as ApiScope]
);

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/**
 * Does a key holding `granted` satisfy `required`?
 *
 * `resource:write` implies `resource:read`. Without the implication every
 * integration that creates something and then reads it back — which is most of
 * them — would need both scopes ticked, and the first support call would be
 * "we ticked write and GET returns 403".
 */
export function apiScopeSatisfied(granted: readonly string[], required: ApiScope): boolean {
  if (granted.includes(required)) return true;
  const [resource, access] = required.split(':') as [ApiResource, ApiAccess];
  return access === 'read' && granted.includes(`${resource}:write`);
}

/** Resources whose scopes only mean anything while another module is enabled. */
export const API_MODULE_RESOURCES: Partial<Record<ApiResource, 'cantieri'>> = {
  cantieri: 'cantieri',
};

// ── Key shape ──────────────────────────────────────────────────────────────
//
// `sq_live_<key_id>_<secret>`:
//   sq_live   fixed prefix. Makes a leaked token greppable — secret scanners
//             and our own log review key off it.
//   key_id    16 hex chars, the public handle stored in api_keys.key_id.
//   secret    43 chars of base64url (32 random bytes). Only its sha256 is kept.
export const API_KEY_PREFIX = 'sq_live_';
export const API_KEY_ID_LENGTH = 16;
export const API_KEY_SECRET_BYTES = 32;
/** `sq_live_<16 hex>_<43 base64url>` — the exact token the customer pastes. */
export const API_KEY_TOKEN_RE = /^sq_live_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

export const API_KEY_NAME_MAX = 80;
/** Live keys per tenant. A ceiling, not a quota: it exists so a scripted bug
 *  cannot mint keys until the list is unreadable. */
export const API_KEYS_PER_TENANT_MAX = 25;
export const API_KEY_RATE_LIMIT_DEFAULT = 120;
export const API_KEY_RATE_LIMIT_MIN = 1;
export const API_KEY_RATE_LIMIT_MAX = 6000;

/** Default page size and ceiling for every list endpoint on the public API. */
export const API_PAGE_SIZE_DEFAULT = 100;
export const API_PAGE_SIZE_MAX = 500;

/** One key as the Settings screen sees it. The secret is NOT here — it exists
 *  exactly once, in the response to the create call. */
export interface ApiKeySummary {
  id: string;
  name: string;
  key_id: string;
  last_four: string;
  scopes: ApiScope[];
  rate_limit_per_min: number;
  expires_at: string | null;
  created_at: string;
  created_by_label: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
}

/** The create response, and the only time the token is ever transmitted. */
export interface ApiKeyCreated extends ApiKeySummary {
  token: string;
}

/** Is this key usable right now, from the summary alone (the same three
 *  conditions the API checks server-side)? */
export function apiKeyIsActive(k: ApiKeySummary, now = new Date()): boolean {
  if (k.revoked_at) return false;
  if (k.expires_at && new Date(k.expires_at).getTime() <= now.getTime()) return false;
  return true;
}
