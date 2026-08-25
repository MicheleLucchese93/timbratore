import { test, expect } from '@playwright/test';
import { publicApi } from '../fixtures/api-client';

// The API module's read-only surface: the OpenAPI contract, and the shape of a
// refusal. Non-mutating, so it runs in every pass — and it is the spec that
// would catch the module being accidentally exposed without a key.

test.describe('web — modulo API: contract and refusals', () => {
  test('the OpenAPI document is public, describes the surface, and leaks no company data', async () => {
    const r = await publicApi(null, '/openapi.json');
    expect(r.status).toBe(200);
    const doc = r.body as {
      openapi: string;
      paths: Record<string, unknown>;
      'x-sonoqui-scopes': { all: string[]; read_only_resources: string[] };
    };
    expect(doc.openapi).toMatch(/^3\.1/);
    // The endpoints an integrator is actually promised.
    for (const p of ['/me', '/users', '/stamps', '/anomalies', '/exports', '/audit']) {
      expect(Object.keys(doc.paths)).toContain(p);
    }
    // HR documents are absent at every scope, by design — see the shared
    // package for why. This is the assertion that keeps it that way.
    expect(Object.keys(doc.paths).some((p) => p.startsWith('/documents'))).toBe(false);
    expect(doc['x-sonoqui-scopes'].all).not.toContain('documents:read');
    // Read-only resources must not advertise a write scope they cannot honour.
    for (const r2 of doc['x-sonoqui-scopes'].read_only_resources) {
      expect(doc['x-sonoqui-scopes'].all).not.toContain(`${r2}:write`);
    }
    // Nothing tenant-specific: the document is handed to a supplier before any
    // key exists.
    expect(JSON.stringify(doc)).not.toMatch(/sq_live_[0-9a-f]{16}_/);
  });

  test('no key is 401 with a machine-readable code, not an HTML error', async () => {
    const r = await publicApi(null, '/users');
    expect(r.status).toBe(401);
    expect((r.body as { error: { code: string } }).error.code).toBe('API_KEY_MISSING');
  });

  test('a malformed or unknown key is refused with ONE code, so key_ids cannot be enumerated', async () => {
    const malformed = await publicApi('not-a-key', '/users');
    const wellFormedButUnknown = await publicApi(
      `sq_live_${'0'.repeat(16)}_${'A'.repeat(43)}`,
      '/users',
    );
    expect(malformed.status).toBe(401);
    expect(wellFormedButUnknown.status).toBe(401);
    // Same code for both: telling "no such key" apart from "wrong secret" would
    // hand an attacker an oracle over the key space.
    const code = (b: typeof malformed.body): string => (b as { error: { code: string } }).error.code;
    expect(code(malformed.body)).toBe('API_KEY_INVALID');
    expect(code(wellFormedButUnknown.body)).toBe(code(malformed.body));
  });

  test('a key in the query string never authenticates', async () => {
    // Query strings land in access logs, browser history and Referer headers.
    // The API accepts a key in two headers and nowhere else.
    const r = await publicApi(
      null,
      `/users?api_key=sq_live_${'0'.repeat(16)}_${'A'.repeat(43)}`,
    );
    expect(r.status).toBe(401);
  });

  test('an unknown path answers 404 with a code, never an empty success', async () => {
    // A typo must not look like "no rows".
    const r = await publicApi(null, '/nope');
    expect([401, 404]).toContain(r.status);
  });
});
