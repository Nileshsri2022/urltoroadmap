'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const planner = require('../lib/planner');

const methodology = {
  ok: true,
  skills: {
    writingPlans: { text: '# Writing Plans\nBite-sized verifiable steps.', chars: 44 },
    brainstorming: { text: '# Brainstorming', chars: 15 },
  },
};

function outlineFixture() {
  return {
    title: 'Rust', emoji: '🦀', summary: 'Learn Rust', difficulty: 'beginner',
    estimatedDuration: '8 weeks', principles: ['Ship small'], milestoneProject: 'CLI',
    phases: [{ id: 'p1', title: 'Foundations', goal: 'Own the basics', duration: 'W1', skills: ['ownership'], stepTitles: ['Read ch 4'] }],
  };
}

test('mergeRoadmap joins expanded phases by index and keeps outline metadata', () => {
  const rm = planner.mergeRoadmap(outlineFixture(), [{
    id: 'p1', miniProject: 'CLI', checklist: ['a', 'b'],
    steps: [{ id: 'p1s1', title: 'Read ch 4', detail: 'x'.repeat(120), hours: 2, verify: 'explain', covers: [], addressesPitfalls: [], resources: [] }],
  }]);
  assert.equal(rm.title, 'Rust');
  assert.equal(rm.phases[0].miniProject, 'CLI');
  assert.equal(rm.phases[0].steps.length, 1);
});

test('expandPhase sends the full writing-plans skill text', async () => {
  let seen = '';
  const deps = { chatJson: async (_s, system) => { seen = system; return {
    id: 'p1', miniProject: 'CLI', checklist: ['a', 'b'],
    steps: [{ id: 'p1s1', title: 'Read', detail: 'y'.repeat(150), hours: 1, verify: 'v', covers: [], addressesPitfalls: [], resources: [] }],
  }; } };
  await planner.expandPhase({}, { input: 'rust', research: {}, interview: {}, methodology }, outlineFixture(), outlineFixture().phases[0], deps);
  assert.ok(seen.includes('# Writing Plans'));
  assert.ok(seen.includes('Bite-sized verifiable steps.'));
});

test('outline sends the full writing-plans skill and asks for content-driven size', async () => {
  let seen = '';
  const deps = { chatJson: async (_s, system) => { seen = system; return outlineFixture(); } };
  const out = await planner.outline({}, { input: 'rust', research: {}, interview: {}, methodology }, deps);
  assert.equal(out.title, 'Rust');
  assert.ok(seen.includes('# Writing Plans'));
  assert.ok(/as many phases and steps as the subject genuinely needs/i.test(seen));
});

test('repairPhase sends the exact missing values back', async () => {
  let seen = '';
  const deps = { chatJson: async (_s, _sys, user) => { seen = user; return outlineFixture().phases[0]; } };
  await planner.repairPhase({}, { input: 'rust', research: {}, interview: {}, methodology }, outlineFixture().phases[0], [{ path: '$.phases[0]', message: 'Missing', missing: ['Lifetimes'] }], deps);
  assert.ok(seen.includes('Lifetimes'));
  assert.ok(seen.includes('$.phases[0]'));
});

test('estimateChars measures serialized size', () => {
  assert.equal(planner.estimateChars({ a: 1 }), JSON.stringify({ a: 1 }).length);
});
