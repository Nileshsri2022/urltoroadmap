'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const reviewer = require('../lib/reviewer');

test('aggregateReviews requires every chunk to approve and takes the minimum score', () => {
  const out = reviewer.aggregateReviews([
    { approved: true, score: 9, checklist: [{ item: 'a', passed: true }], issues: [] },
    { approved: false, score: 6, checklist: [{ item: 'b', passed: false }], issues: [{ problem: 'p', fix: 'f' }] },
  ]);
  assert.equal(out.approved, false);
  assert.equal(out.score, 6);
  assert.equal(out.issues.length, 1);
  assert.equal(out.checklist.length, 2);
});

test('chunkPhases splits by serialized size', () => {
  const phases = [{ id: 'p1', steps: [], pad: 'x'.repeat(60) }, { id: 'p2', steps: [], pad: 'y'.repeat(60) }, { id: 'p3', steps: [], pad: 'z'.repeat(60) }];
  const chunks = reviewer.chunkPhases(phases, 80);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.flat().length, 3);
});

test('review uses one call when the payload fits the budget', async () => {
  let calls = 0;
  const deps = { chatJson: async () => { calls++; return { approved: true, score: 9, checklist: [], issues: [] }; } };
  const ctx = { input: 'rust', research: {}, interview: {}, roadmap: { title: 'R', phases: [{ id: 'p1', steps: [] }] } };
  const out = await reviewer.review({ callCharBudget: 24000 }, ctx, deps);
  assert.equal(calls, 1);
  assert.equal(out.approved, true);
});
