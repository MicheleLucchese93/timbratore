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
    user: { lat: 41.8957, lng: 12.4823, accuracyM: 10 },
    branch: { lat: 41.8957, lng: 12.4823, radiusM: 300, smartWorking: false },
    policy: 'strict',
  });
  assert.equal(r.allowed, true);
});

test('smart_working always allowed', () => {
  const r = withinGeofence({
    user: { lat: 0, lng: 0, accuracyM: 5 },
    branch: { lat: 41.8957, lng: 12.4823, radiusM: 300, smartWorking: true },
    policy: 'strict',
  });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'smart_working');
});

test('lenient policy adds accuracy', () => {
  const branchAt = { lat: 41.8957, lng: 12.4823 };
  // Move user 350m east-ish (~ 0.0042 lng at 41.9°)
  const userAt = { lat: 41.8957, lng: 12.4823 + 0.0042 };
  // Should be ~349m. With radius 300m + accuracy 60m, lenient should allow it.
  const lenient = withinGeofence({
    user: { ...userAt, accuracyM: 60 },
    branch: { ...branchAt, radiusM: 300, smartWorking: false },
    policy: 'lenient',
  });
  assert.equal(lenient.allowed, true);
  const strict = withinGeofence({
    user: { ...userAt, accuracyM: 60 },
    branch: { ...branchAt, radiusM: 300, smartWorking: false },
    policy: 'strict',
  });
  assert.equal(strict.allowed, false);
});
