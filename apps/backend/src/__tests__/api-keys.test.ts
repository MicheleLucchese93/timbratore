import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_KEYS_PER_TENANT_MAX,
  API_KEY_TOKEN_RE,
  API_READ_ONLY_RESOURCES,
  API_RESOURCES,
  API_SCOPES,
  apiKeyIsActive,
  apiScopeSatisfied,
  isApiScope,
  type ApiKeySummary,
  type ApiScope,
} from '@sonoqui/shared';
import { hashSecret, mintKey } from '../lib/api-keys.js';

// The API module's credential logic, tested where it is pure. Everything here
// is a property a bug would break silently: a token that cannot be parsed back,
// a hash that leaks, a scope check that grants more than it was asked for.

test('a minted token parses back to the row it names', () => {
  const k = mintKey();
  const m = API_KEY_TOKEN_RE.exec(k.token);
  assert.ok(m, `minted token does not match the published format: ${k.token}`);
  assert.equal(m[1], k.keyId);
  // The secret half is never stored, but the hash of it must be reproducible
  // from the token alone — that is the whole authentication path.
  assert.equal(hashSecret(m[2] as string), k.secretHash);
  // …and the display hint must come off the SECRET, not the id: showing four
  // characters of the public half would identify nothing.
  assert.equal(k.lastFour, (m[2] as string).slice(-4));
});

test('the token never contains the stored hash', () => {
  const k = mintKey();
  assert.ok(!k.token.includes(k.secretHash));
  // sha256 hex, so a fixed 64 chars — a shorter digest would mean a different
  // algorithm slipped in.
  assert.equal(k.secretHash.length, 64);
  assert.match(k.secretHash, /^[0-9a-f]{64}$/);
});

test('two mints never collide', () => {
  const ids = new Set<string>();
  const tokens = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    const k = mintKey();
    ids.add(k.keyId);
    tokens.add(k.token);
  }
  assert.equal(ids.size, 500, 'key_id collision — key_id is UNIQUE in the DB');
  assert.equal(tokens.size, 500);
});

test('the token format rejects everything that is not one', () => {
  const good = mintKey().token;
  for (const bad of [
    '',
    'sq_live_',
    good.slice(0, -1), // truncated secret
    `${good}x`, // trailing junk
    good.replace('sq_live_', 'sq_test_'), // wrong environment prefix
    good.toUpperCase(), // key_id is lower-case hex
    ` ${good}`, // callers must trim before matching
    good.replace('_', '-'),
  ]) {
    assert.equal(API_KEY_TOKEN_RE.test(bad), false, `accepted a bad token: ${bad}`);
  }
});

test('write implies read, and never the other way round', () => {
  assert.equal(apiScopeSatisfied(['stamps:write'], 'stamps:read'), true);
  assert.equal(apiScopeSatisfied(['stamps:read'], 'stamps:write'), false);
  // And the implication does not leak across resources.
  assert.equal(apiScopeSatisfied(['stamps:write'], 'users:read'), false);
  assert.equal(apiScopeSatisfied([], 'stamps:read'), false);
  // Garbage in the granted array must not satisfy anything.
  assert.equal(apiScopeSatisfied(['*', 'admin', 'stamps'], 'stamps:read'), false);
});

test('the scope catalogue matches the resource lists exactly', () => {
  for (const r of API_RESOURCES) {
    const read = `${r}:read` as ApiScope;
    const write = `${r}:write` as ApiScope;
    assert.ok(API_SCOPES.includes(read), `${r} has no read scope`);
    const readOnly = API_READ_ONLY_RESOURCES.includes(r);
    assert.equal(
      API_SCOPES.includes(write),
      !readOnly,
      readOnly
        ? `${r} is read-only but a write scope exists — the API would advertise a permission it cannot honour`
        : `${r} should have a write scope`
    );
  }
  // Every published scope is recognised by the validator the API gates on.
  for (const s of API_SCOPES) assert.equal(isApiScope(s), true, `${s} fails isApiScope`);
  assert.equal(isApiScope('documents:read'), false, 'documents must not be a scope');
  assert.equal(isApiScope('stamps:admin'), false);
});

test('apiKeyIsActive agrees with the three server-side conditions', () => {
  const base: ApiKeySummary = {
    id: 'k',
    name: 'Gestionale',
    key_id: '0123456789abcdef',
    last_four: 'abcd',
    scopes: ['stamps:read'],
    rate_limit_per_min: 120,
    expires_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by_label: null,
    last_used_at: null,
    last_used_ip: null,
    revoked_at: null,
  };
  const now = new Date('2026-03-01T12:00:00.000Z');
  assert.equal(apiKeyIsActive(base, now), true);
  assert.equal(apiKeyIsActive({ ...base, revoked_at: '2026-02-01T00:00:00.000Z' }, now), false);
  assert.equal(apiKeyIsActive({ ...base, expires_at: '2026-02-01T00:00:00.000Z' }, now), false);
  // Not yet expired stays usable, and the boundary is exclusive on the past
  // side only: a key expiring in a minute still works.
  assert.equal(apiKeyIsActive({ ...base, expires_at: '2026-03-01T12:01:00.000Z' }, now), true);
  // Exactly at the instant it expires, it does not.
  assert.equal(apiKeyIsActive({ ...base, expires_at: '2026-03-01T12:00:00.000Z' }, now), false);
});

test('the per-tenant ceiling is a sane number', () => {
  // A guard, not a quota: low enough that the Settings list stays readable,
  // high enough that no real customer hits it.
  assert.ok(API_KEYS_PER_TENANT_MAX >= 5 && API_KEYS_PER_TENANT_MAX <= 100);
});
