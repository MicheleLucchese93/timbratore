import {
  API_KEY_PREFIX,
  API_PAGE_SIZE_DEFAULT,
  API_PAGE_SIZE_MAX,
  API_RESOURCES,
  API_READ_ONLY_RESOURCES,
  API_SCOPES,
} from '@sonoqui/shared';

/**
 * The machine-readable contract for /api/public/v1.
 *
 * Hand-written rather than derived from the zod schemas, and that is a choice:
 * a generated document tracks the CODE, so a refactor silently becomes a
 * published API change. This one tracks the PROMISE — it changes when we decide
 * the contract changes. What it does read from the shared constants is the scope
 * vocabulary, which must never disagree with what the API enforces.
 *
 * Enough for an integrator to generate a client and for Postman/Insomnia to
 * import: paths, methods, required scope, the common query parameters and the
 * response envelope. Field-level schemas for every resource are deliberately
 * summarised — the endpoints return the documented row shapes, and pinning every
 * column here would create a second place to forget.
 */

interface Op {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  scope: string | null;
  query?: string[];
  body?: string[];
  /** Required body fields, so a client generator can mark them. */
  required?: string[];
  /** Does this operation take limit/offset and answer with a `page` block?
   *  Stated per operation: guessing it from the path shape advertised paging on
   *  four endpoints that do not have it, and hid it on one that does. */
  paged?: boolean;
  /** Non-JSON response (the export download). */
  binary?: boolean;
  /** Honours an `Idempotency-Key` header: a repeat replays the first answer. */
  idempotent?: boolean;
}

const OPS: Op[] = [
  { method: 'get', path: '/me', summary: 'What this key is: its name, scopes and the company it belongs to.', scope: null },

  { method: 'get', path: '/users', summary: 'Employees, paginated.', scope: 'users:read', query: ['active', 'role', 'email', 'external_id', 'branch_id'] , paged: true },
  { method: 'get', path: '/users/{id}', summary: 'One employee.', scope: 'users:read' },
  { method: 'post', path: '/users', summary: 'Add an employee and optionally send their access email.', scope: 'users:write', body: ['email', 'first_name', 'last_name', 'role', 'branch_ids', 'external_id', 'matricola', 'codice_fiscale', 'send_invite'] , required: ['email'] },
  { method: 'patch', path: '/users/{id}', summary: 'Update anagrafica, role or sede assignment.', scope: 'users:write' , body: ['first_name', 'last_name', 'role', 'external_id', 'matricola', 'codice_fiscale', 'inail', 'qualifica', 'qualifica2', 'branch_ids'] },
  { method: 'post', path: '/users/{id}/deactivate', summary: 'Stop the login, keep the history. There is no hard delete.', scope: 'users:write' },
  { method: 'post', path: '/users/{id}/reactivate', summary: 'Undo a deactivation.', scope: 'users:write' },

  { method: 'get', path: '/branches', summary: 'Sedi, with their geofence configuration.', scope: 'branches:read', query: ['active'] , paged: true },
  { method: 'get', path: '/branches/{id}', summary: 'One sede.', scope: 'branches:read' },
  { method: 'get', path: '/branches/{id}/members', summary: 'Employees assigned to a sede.', scope: 'branches:read' },
  { method: 'post', path: '/branches', summary: 'Create a sede.', scope: 'branches:write' , required: ['name'] },
  { method: 'patch', path: '/branches/{id}', summary: 'Update a sede.', scope: 'branches:write' , body: ['name', 'address', 'latitude', 'longitude', 'radius_m', 'enforce_radius', 'smart_working', 'active', 'ordering'] },
  { method: 'delete', path: '/branches/{id}', summary: 'Soft-delete a sede (punches keep referring to it).', scope: 'branches:write' },
  { method: 'put', path: '/branches/{id}/members', summary: 'Replace the sede roster wholesale.', scope: 'branches:write' , body: ['user_ids'] },

  { method: 'get', path: '/stamps', summary: 'Punches. Never includes coordinates — only the geofence verdict.', scope: 'stamps:read', query: ['user_id', 'branch_id', 'event_type', 'from', 'to', 'include_deleted', 'updated_since'] , paged: true },
  { method: 'get', path: '/stamps/{id}', summary: 'One punch.', scope: 'stamps:read' },
  { method: 'get', path: '/stamps/{id}/history', summary: 'The append-only provenance trail of one punch.', scope: 'stamps:read' },
  { method: 'post', path: '/stamps', summary: 'File a punch (badge reader, turnstile). `reason` is required.', scope: 'stamps:write', body: ['user_id', 'event_type', 'occurred_at', 'branch_id', 'notes', 'reason'] , required: ['user_id', 'event_type', 'occurred_at', 'reason'] },
  { method: 'patch', path: '/stamps/{id}', summary: 'Correct a punch. `reason` is required and is recorded.', scope: 'stamps:write' , body: ['event_type', 'occurred_at', 'branch_id', 'notes', 'reason'], required: ['reason'] },
  { method: 'delete', path: '/stamps/{id}', summary: 'Strike a punch (soft delete). `reason` is required.', scope: 'stamps:write' , body: ['reason'], required: ['reason'] },

  { method: 'get', path: '/anomalies', summary: 'Schedule deviations for a date range. Computed, so the range is the bound.', scope: 'anomalies:read', query: ['from', 'to', 'user_id', 'kind'] },
  { method: 'post', path: '/anomalies/justify', summary: 'Annotate an anomaly. Idempotent per (employee, day, kind).', scope: 'anomalies:write', body: ['user_id', 'date', 'kind', 'note'] , required: ['user_id', 'date', 'kind', 'note'] },

  { method: 'get', path: '/corrections', summary: 'Rettifiche (correction requests). Read-only: deciding one names a person.', scope: 'corrections:read', query: ['user_id', 'status'] , paged: true },
  { method: 'get', path: '/corrections/{id}', summary: 'One correction request.', scope: 'corrections:read' },

  { method: 'get', path: '/leaves', summary: 'Absences overlapping a window. Read-only by design.', scope: 'leaves:read', query: ['user_id', 'status', 'type', 'from', 'to'] , paged: true },
  { method: 'get', path: '/leaves/{id}', summary: 'One absence.', scope: 'leaves:read' },

  { method: 'get', path: '/quotas', summary: 'Leave budgets, one row per (employee, type).', scope: 'quotas:read', query: ['user_id', 'type', 'include_ended'] , paged: true },
  { method: 'get', path: '/quotas/{userId}', summary: 'Residual balance per leave type for one employee.', scope: 'quotas:read' },
  { method: 'get', path: '/quotas/{userId}/accruals', summary: 'The accrual ledger behind those balances.', scope: 'quotas:read' , paged: true },

  { method: 'get', path: '/shifts/templates', summary: 'Orari, with their weekly slots.', scope: 'shifts:read' , paged: true },
  { method: 'get', path: '/shifts/assignments', summary: 'Which orario each employee is on. `?on=` asks about one day.', scope: 'shifts:read', query: ['user_id', 'on'] , paged: true },
  { method: 'post', path: '/shifts/assignments', summary: 'Put employees on an orario from a date; supersedes the previous one.', scope: 'shifts:write', body: ['user_ids', 'shift_template_id', 'valid_from'] , required: ['user_ids', 'shift_template_id', 'valid_from'] },

  { method: 'get', path: '/bulletins', summary: 'Bacheca messages with their read counts.', scope: 'bulletins:read', query: ['live'] , paged: true },
  { method: 'get', path: '/bulletins/{id}/reads', summary: 'Who has opened a message.', scope: 'bulletins:read' },

  { method: 'get', path: '/cantieri/sites', summary: 'Sites. Requires the Cantieri module.', scope: 'cantieri:read', query: ['status'] , paged: true },
  { method: 'get', path: '/cantieri/vehicles', summary: 'Vehicles. Requires the Cantieri module.', scope: 'cantieri:read' , paged: true },
  { method: 'get', path: '/cantieri/fields', summary: 'Custom field definitions, to decode `custom_values`.', scope: 'cantieri:read' },
  { method: 'get', path: '/cantieri/entries', summary: 'Site activity entries.', scope: 'cantieri:read', query: ['cantiere_id', 'user_id', 'from', 'to'] , paged: true },
  { method: 'get', path: '/cantieri/entries/{id}', summary: 'One activity entry.', scope: 'cantieri:read' },

  { method: 'post', path: '/exports', summary: 'Enqueue an export (xlsx | json | centro). Returns a job to poll.', scope: 'exports:write', body: ['format', 'period_from', 'period_to', 'filters'] , required: ['format', 'period_from', 'period_to'] },
  { method: 'get', path: '/exports', summary: 'Export jobs.', scope: 'exports:read', query: ['status'] , paged: true },
  { method: 'get', path: '/exports/{id}', summary: 'One job — poll until `status` is `ready`.', scope: 'exports:read' },
  { method: 'get', path: '/exports/{id}/download', summary: 'The file itself. Raw bytes, not a JSON envelope.', scope: 'exports:read' , binary: true },

  { method: 'get', path: '/reports/worked-minutes', summary: 'Daily worked minutes per employee. Not the payroll figure — use an export for that.', scope: 'reports:read', query: ['from', 'to', 'user_id'] , paged: true },
  { method: 'get', path: '/reports/present', summary: 'Who is on the clock right now.', scope: 'reports:read' },

  { method: 'get', path: '/audit', summary: 'The company Registro attività, including what this API did.', scope: 'audit:read', query: ['from', 'to', 'action', 'actor', 'target'] , paged: true },
];

const ENVELOPE = {
  type: 'object',
  properties: { ok: { type: 'boolean', enum: [true] }, data: {} },
  required: ['ok', 'data'],
};

const PAGED_ENVELOPE = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', enum: [true] },
    data: { type: 'array', items: {} },
    page: {
      type: 'object',
      description:
        '`total` counts the FILTERED set, not the table — what a caller paging through "March\'s punches" needs. It is null when the caller paged past the end (there is no row to carry the count) and 0 on an empty first page.',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        total: { type: 'integer', nullable: true },
      },
      required: ['limit', 'offset'],
    },
  },
  required: ['ok', 'data', 'page'],
};

const ERROR = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {},
      },
      required: ['code', 'message'],
    },
  },
  required: ['ok', 'error'],
};

const COMMON_PARAMS: Record<string, Record<string, unknown>> = {
  limit: { name: 'limit', in: 'query', schema: { type: 'integer', default: API_PAGE_SIZE_DEFAULT, maximum: API_PAGE_SIZE_MAX } },
  offset: { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
  from: { name: 'from', in: 'query', description: 'Tenant-local calendar day, YYYY-MM-DD.', schema: { type: 'string', format: 'date' } },
  to: { name: 'to', in: 'query', description: 'Tenant-local calendar day, YYYY-MM-DD, inclusive.', schema: { type: 'string', format: 'date' } },
};

function paramFor(name: string): Record<string, unknown> {
  return COMMON_PARAMS[name] ?? { name, in: 'query', schema: { type: 'string' } };
}

export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params: Array<Record<string, unknown>> = [];
    for (const seg of op.path.matchAll(/\{(\w+)\}/g)) {
      params.push({
        name: seg[1],
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      });
    }
    if (op.paged) {
      params.push(paramFor('limit'), paramFor('offset'));
    }
    if (op.idempotent) {
      params.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description:
          'Optional. 8–128 characters of letters, digits or hyphens. Repeating a request with the same key replays the first response instead of performing the action again — send one when a timeout leaves you unsure whether the punch landed. Keys are scoped to the API key that used them and are remembered for 24 hours.',
        schema: { type: 'string', pattern: '^[a-zA-Z0-9-]{8,128}$' },
      });
    }
    for (const q of op.query ?? []) params.push(paramFor(q));

    (paths[op.path] ??= {})[op.method] = {
      summary: op.summary,
      description: op.scope
        ? `Requires the \`${op.scope}\` scope. A \`:write\` scope also grants the matching \`:read\`.`
        : 'Requires any valid key.',
      // Two alternatives, not two requirements. Scopes are documented in the
      // description rather than as OAuth-style scope arrays, because neither of
      // these scheme types carries them in OpenAPI.
      security: [{ ApiKeyAuth: [] }, { ApiKeyHeader: [] }],
      ...(params.length ? { parameters: params } : {}),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    description: `Fields: ${op.body.join(', ')}.`,
                    properties: Object.fromEntries(op.body.map((f) => [f, {}])),
                    ...(op.required?.length ? { required: op.required } : {}),
                  },
                },
              },
            },
          }
        : {}),
      responses: {
        [op.method === 'post' && !op.path.includes('{') ? '201' : '200']: op.binary
          ? {
              description: 'The file itself — raw bytes, not the JSON envelope.',
              content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
            }
          : {
              description: 'Success',
              content: { 'application/json': { schema: op.paged ? PAGED_ENVELOPE : ENVELOPE } },
            },
        '400': { description: 'VALIDATION — the body or query failed validation; `error.details` names the fields. Also BODY_TOO_LARGE for a body over 1MB.', content: { 'application/json': { schema: ERROR } } },
        '401': { description: 'API_KEY_MISSING (no key presented) or API_KEY_INVALID (unknown, wrong secret, revoked, or expired — one code for all four, so key ids cannot be enumerated).', content: { 'application/json': { schema: ERROR } } },
        '403': { description: 'API_SCOPE_MISSING (names the missing scope), API_MODULE_DISABLED (the module is off for this company), CANTIERI_REQUIRED, or API_TENANT_UNAVAILABLE (the company is suspended or deleted).', content: { 'application/json': { schema: ERROR } } },
        '404': { description: 'NOT_FOUND — no such row, or no such endpoint. A malformed id answers 404 rather than an error, because it cannot name a row.', content: { 'application/json': { schema: ERROR } } },
        '409': { description: 'CONFLICT — includes LIMIT_REACHED (a contractual ceiling), LAST_ADMIN, ALREADY_ACTIVE / ALREADY_INACTIVE, and IDEMPOTENCY_IN_FLIGHT (the first request with this Idempotency-Key has not finished yet; retry shortly).', content: { 'application/json': { schema: ERROR } } },
        '429': { description: 'API_RATE_LIMITED — the per-key ceiling, or the failure guard on the auth path. Standard RateLimit-* headers are returned.', content: { 'application/json': { schema: ERROR } } },
        '500': { description: 'INTERNAL — `error.details.request_id` identifies the request; quote it in a support ticket.', content: { 'application/json': { schema: ERROR } } },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'sonoQui API',
      version: '1.0.0',
      description: [
        'The API module of sonoQui. A key belongs to a COMPANY, not to a person:',
        `present it as \`Authorization: Bearer ${API_KEY_PREFIX}<key_id>_<secret>\` or as \`X-Api-Key\`.`,
        'The tenant is resolved from the key, so there is no company id to pass.',
        '',
        'Every response is `{ ok, data }`; list endpoints add `page`. Rate limiting is',
        'per key, from the ceiling on the key itself, and the standard `RateLimit-*`',
        'headers are returned.',
        '',
        'HR documents are deliberately absent at every scope: they are gated behind a',
        'one-time code sent to a person, and a machine credential is by construction a',
        'way around that.',
      ].join('\n'),
    },
    servers: [{ url: '/api/public/v1' }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'The token shown once when the key was created.',
        },
        // The same token, in the header most gestionali offer as a checkbox.
        // Declared rather than mentioned in prose so a generated client can
        // actually offer it. Either scheme alone is sufficient — OpenAPI spells
        // that as two separate one-element requirement objects.
        ApiKeyHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Api-Key',
          description: 'Alternative to the Authorization header. Same token.',
        },
      },
      schemas: { Envelope: ENVELOPE, Error: ERROR },
    },
    security: [{ ApiKeyAuth: [] }, { ApiKeyHeader: [] }],
    'x-sonoqui-scopes': {
      all: API_SCOPES,
      resources: API_RESOURCES,
      read_only_resources: API_READ_ONLY_RESOURCES,
      note: 'A `resource:write` scope implies `resource:read`.',
    },
    paths,
  };
}
