import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCadence } from './csv.js';

test('detectCadence: 7-day span is weekly', () => {
  const { cadence } = detectCadence(['2026-09-01', '2026-09-03', '2026-09-07']);
  assert.equal(cadence, 'weekly');
});

test('detectCadence: single day is daily', () => {
  const { cadence } = detectCadence(['2026-09-01', '2026-09-01']);
  assert.equal(cadence, 'daily');
});

test('detectCadence: full month span is monthly', () => {
  const { cadence } = detectCadence(['2026-09-01', '2026-09-30']);
  assert.equal(cadence, 'monthly');
});
