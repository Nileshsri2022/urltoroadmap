'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let agents;
let store;

function stubs(overrides = {}) {
  return {
    skills: { loadMethodology: async () => ({ ok: true, source: 'local', path: 'C:\\skills', totalChars: 10, skills: { writingPlans: { text: 'WP' }, brainstorming: { text: 'BS' } } }) },
    planner: {
      outline: async () => ({
        title: 'Rust', emoji: '🦀', summary: 's', difficulty: 'beginner', estimatedDuration: '8w',
        principles: ['p'], milestoneProject: 'CLI',
        phases: [{ id: 'p1', title: 'P1', goal: 'g', duration: 'w1', skills: ['s'], stepTitles: ['t'] }],
      }),
      expandPhase: async (_s, _c, _o, phase) => ({
        ...phase, miniProject: 'mini', checklist: ['a', 'b'],
        steps: [{ id: 'p1s1', title: 't', detail: 'x'.repeat(130), hours: 2, verify: 'v', covers: ['Ownership'], addressesPitfalls: ['Pitfall'], resources: [] }],
      }),
      mergeRoadmap: (o, ps) => ({ ...o, phases: ps }),
      repairPhase: async (_s, _c, phase) => phase,
    },
    validate: { validateRoadmap: () => ({ valid: true, errors: [], coverage: { concepts: { total: 1, covered: 1, missing: [] }, pitfalls: { total: 1, covered: 1, missing: [] } } }) },
    reviewer: { review: async () => ({ approved: true, score: 9, checklist: [], issues: [] }) },
    llm: { chatJson: async () => ({}) },
    research: async () => ({ topic: 'Rust', keyConcepts: ['Ownership'], pitfalls: ['Pitfall'], sources: [] }),
    ...overrides,
  };
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-agents-'));
  process.env.ROADMAP_FORGE_DATA_DIR = dir;
  delete require.cache[require.resolve('../lib/agents')];
  delete require.cache[require.resolve('../lib/store')];
  agents = require('../lib/agents');
  store = require('../lib/store');
  store.saveSettings({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
});

test('runPipeline completes, publishes a roadmap, and records timings', async () => {
  const events = [];
  const run = await agents.runPipeline('rust', (e) => events.push(e), stubs());
  assert.equal(run.status, 'done');
  assert.ok(run.agents.researcher.startedAt > 0);
  assert.ok(run.agents.planner.endedAt >= run.agents.planner.startedAt);
  assert.ok(events.some((e) => e.type === 'done'));
  const saved = store.getRoadmap(run.finalRoadmapId);
  assert.equal(saved.title, 'Rust');
  assert.equal(saved.review.approved, true);
});

test('runPipeline publishes a draft when validation still fails after repair', async () => {
  const badValidate = { validateRoadmap: () => ({ valid: false, errors: [{ code: 'bad-detail', path: '$.phases[0].steps[0].detail', message: 'bad' }], coverage: { concepts: { total: 1, covered: 0, missing: ['Ownership'] }, pitfalls: { total: 0, covered: 0, missing: [] } } }) };
  const run = await agents.runPipeline('rust', () => {}, stubs({ validate: badValidate }));
  assert.equal(run.status, 'done');
  assert.equal(run.repairs, 2);
  const saved = store.getRoadmap(run.finalRoadmapId);
  assert.equal(saved.review.approved, false);
  assert.equal(saved.review.reviewerApproved, true);
  assert.equal(saved.review.validation.valid, false);
});
