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

test('review aggregates the multi-chunk path when the payload exceeds the budget', async () => {
  // Each phase serializes to ~1231 chars; with a 2000 budget the chunk cap is
  // max(2000, floor(2000*0.7)) = 2000, so chunkPhases yields 3 chunks. The
  // review() code makes one call per chunk plus one global/outline call = 4.
  const phases = ['p1', 'p2', 'p3'].map((id, i) => ({ id, steps: [], pad: 'x'.repeat(1200 + i) }));
  const responses = [
    { approved: true, score: 8, checklist: [{ item: 'a', passed: true }], issues: [] },
    { approved: false, score: 5, checklist: [{ item: 'b', passed: false }], issues: [{ phaseId: 'p2', problem: 'bad', fix: 'fix' }] },
    { approved: true, score: 7, checklist: [], issues: [] },
    { approved: true, score: 10, checklist: [], issues: [] }, // global/outline pass
  ];
  const prompts = [];
  let call = 0;
  const deps = { chatJson: async (_settings, _system, user) => { prompts.push(user); return responses[call++]; } };
  const ctx = { input: 'rust', research: {}, interview: {}, roadmap: { title: 'R', phases } };
  const out = await reviewer.review({ callCharBudget: 2000 }, ctx, deps);

  assert.equal(call, 4);
  assert.equal(prompts.length, 4);
  assert.ok(prompts.some((p) => p.includes('<outline>')), 'expected one global/outline call');
  assert.ok(Array.isArray(out.chunks), 'aggregated result must include chunks');
  assert.equal(out.chunks.length, 4);
  assert.equal(out.approved, false, 'all chunks must approve for the aggregate to approve');
  assert.equal(out.score, 5, 'aggregate score is the minimum across all calls');
  assert.equal(out.issues.length, 1);
  assert.equal(out.checklist.length, 2);
});
