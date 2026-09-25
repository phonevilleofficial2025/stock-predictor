import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeUnservedSeries } from './balance.js';

test('computeUnservedSeries: cumulative across months', () => {
  const result = computeUnservedSeries([
    { month: '2026-07', totalCpfr: 50, monthBalance: 20 }, // unserved = 30
    { month: '2026-08', totalCpfr: 10, monthBalance: 5 },  // unserved = 30 + 10 - 5 = 35
    { month: '2026-09', totalCpfr: 0, monthBalance: 40 },  // unserved = 35 + 0 - 40 = -5
  ]);
  assert.equal(result[0].unserved, 30);
  assert.equal(result[1].unserved, 35);
  assert.equal(result[2].unserved, -5);
});

test('computeUnservedSeries: single month with no prior carry-over', () => {
  const result = computeUnservedSeries([{ month: '2026-01', totalCpfr: 12, monthBalance: 12 }]);
  assert.equal(result[0].unserved, 0);
});
