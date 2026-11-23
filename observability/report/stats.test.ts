import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bootstrapMeanInterval, passHatK} from './stats.ts';

test('bootstrap interval: none for one value, exact for constant values, seeded', () => {
  assert.equal(bootstrapMeanInterval([3]), null);
  assert.deepEqual(bootstrapMeanInterval([2, 2, 2]), [2, 2]);
  const xs = [1, -2, 3, 5, -1, 0, 4];
  assert.deepEqual(bootstrapMeanInterval(xs), bootstrapMeanInterval(xs));
  const [lo, hi] = bootstrapMeanInterval(xs) ?? [0, 0];
  assert.ok(lo < 10 / 7 && 10 / 7 < hi);
});

test('pass^k is C(c,k)/C(n,k)', () => {
  assert.equal(passHatK(4, 4, 3), 1);
  assert.equal(passHatK(4, 2, 3), 0);
  assert.equal(passHatK(4, 3, 3), 0.25);
  assert.equal(passHatK(2, 2, 3), null);
});
