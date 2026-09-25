import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStatus, computeDevicePrediction, computeSuggestion, splitSuggestionByVariant } from './predictions.js';

test('non-flagship: score > 8 is Healthy', () => {
  assert.equal(classifyStatus(8.01, false), 'Healthy');
});

test('non-flagship: score exactly 8 is Moderate, not Healthy', () => {
  assert.equal(classifyStatus(8, false), 'Moderate');
});

test('non-flagship: score exactly 4 is Critical', () => {
  assert.equal(classifyStatus(4, false), 'Critical');
});

test('non-flagship: score between 4 and 8 is Moderate', () => {
  assert.equal(classifyStatus(6, false), 'Moderate');
});

test('flagship: score exactly 4 is Healthy (not Critical)', () => {
  assert.equal(classifyStatus(4, true), 'Healthy');
});

test('flagship: score just below 4 is Critical', () => {
  assert.equal(classifyStatus(3.99, true), 'Critical');
});

test('flagship: score of 6 is Healthy, no Moderate tier', () => {
  assert.equal(classifyStatus(6, true), 'Healthy');
});

test('computeDevicePrediction: base formula matches spec example', () => {
  // avg2wk = 10, estimatedSellout = 20, onHand = 100 -> estimatedOnHand = 80, score = 8 (Moderate for non-flagship)
  const result = computeDevicePrediction({ onHand: 100, week1Qty: 10, week2Qty: 10, isFlagship: false });
  assert.equal(result.avg2wk, 10);
  assert.equal(result.estimatedSellout, 20);
  assert.equal(result.estimatedOnHand, 80);
  assert.equal(result.score, 8);
  assert.equal(result.status, 'Moderate');
});

test('computeDevicePrediction: CPFR-adjusted view can push status to Healthy', () => {
  const result = computeDevicePrediction({ onHand: 100, week1Qty: 10, week2Qty: 10, totalCpfr: 20, isFlagship: false });
  // estimatedOnHandWithCpfr = 100 + 20 - 20 = 100, score = 10 -> Healthy
  assert.equal(result.estimatedOnHandWithCpfr, 100);
  assert.equal(result.scoreWithCpfr, 10);
  assert.equal(result.statusWithCpfr, 'Healthy');
});

test('computeSuggestion: 0 when already healthy', () => {
  const suggestion = computeSuggestion({ onHand: 200, avg2wk: 10, isFlagship: false });
  assert.equal(suggestion, 0);
});

test('computeSuggestion: non-flagship suggestion pushes score strictly above 8', () => {
  const suggestion = computeSuggestion({ onHand: 100, avg2wk: 10, isFlagship: false });
  const resultingOnHand = 100 + suggestion - 20;
  const resultingScore = resultingOnHand / 10;
  assert.ok(resultingScore > 8, `expected score > 8, got ${resultingScore}`);
});

test('computeSuggestion: flagship suggestion reaches score >= 4', () => {
  const suggestion = computeSuggestion({ onHand: 10, avg2wk: 10, isFlagship: true });
  const resultingOnHand = 10 + suggestion - 20;
  const resultingScore = resultingOnHand / 10;
  assert.ok(resultingScore >= 4, `expected score >= 4, got ${resultingScore}`);
});

test('splitSuggestionByVariant: proportional to sell-out share', () => {
  const variants = [
    { sku: 'A', avg2wk: 30 },
    { sku: 'B', avg2wk: 10 },
  ];
  const split = splitSuggestionByVariant(40, variants);
  assert.equal(split.find((v) => v.sku === 'A').suggestedQty, 30);
  assert.equal(split.find((v) => v.sku === 'B').suggestedQty, 10);
});

test('splitSuggestionByVariant: even split when no sell-out history', () => {
  const variants = [{ sku: 'A', avg2wk: 0 }, { sku: 'B', avg2wk: 0 }];
  const split = splitSuggestionByVariant(10, variants);
  assert.equal(split.find((v) => v.sku === 'A').suggestedQty, 5);
  assert.equal(split.find((v) => v.sku === 'B').suggestedQty, 5);
});
