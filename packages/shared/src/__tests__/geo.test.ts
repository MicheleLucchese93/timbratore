import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, withinGeofence } from '../geo.ts';

test('distanceMeters symmetric', () => {
  const a = { lat: 41.8957, lng: 12.4823 };
  const b = { lat: 45.4642, lng: 9.19 };
  assert.equal(distanceMeters(a, b), distanceMeters(b, a));
});

test('distanceMeters Rome→Milan ≈ 477km', () => {
  const a = { lat: 41.8957, lng: 12.4823 };
  const b = { lat: 45.4642, lng: 9.19 };
  const d = distanceMeters(a, b);
  assert.ok(d > 470_000 && d < 480_000, `got ${d}`);
});

test('within radius', () => {
  const r = withinGeofence({
    user: { lat: 41.8957, lng: 12.4823 },
    branch: { lat: 41.8957, lng: 12.4823, radiusM: 300, smartWorking: false },
  });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'within_radius');
});

test('smart_working always allowed', () => {
  const r = withinGeofence({
    user: { lat: 0, lng: 0 },
    branch: { lat: 41.8957, lng: 12.4823, radiusM: 300, smartWorking: true },
  });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'smart_working');
});

test('out of radius rejected', () => {
  const branchAt = { lat: 41.8957, lng: 12.4823 };
  // ~349m east of center — outside a 300m radius.
  const userAt = { lat: 41.8957, lng: 12.4823 + 0.0042 };
  const r = withinGeofence({
    user: userAt,
    branch: { ...branchAt, radiusM: 300, smartWorking: false },
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'out_of_radius');
});
