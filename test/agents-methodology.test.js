'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let agents;
let store;

// Mirrors the fake dependency shape from test/agents.test.js: all local,
// no live LLM and no network.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-agents-method-'));
  process.env.ROADMAP_FORGE_DATA_DIR = dir;
  delete require.cache[require.resolve('../lib/agents')];
  delete require.cache[require.resolve('../lib/store')];
  agents = require('../lib/agents');
  store = require('../lib/store');
  store.saveSettings({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
});

test('runPipeline rejects with an actionable error when MCP methodology fails', async () => {
  // lib/skills.js reports MCP load failure as source:'off' WITH an error field.
  const failed = { ok: false, source: 'off', error: 'No methodology source: ECONNREFUSED', skills: {}, totalChars: 0 };
  const dep = stubs({ skills: { loadMethodology: async () => failed } });

  await assert.rejects(
    () => agents.runPipeline('rust', () => {}, dep),
    (err) => {
      assert.match(err.message, /\[runGeneration\]/, 'names the failing stage');
      assert.match(err.message, /ECONNREFUSED/, 'preserves the original detail verbatim');
      assert.match(err.message, /Settings/, 'gives an actionable next step');
      return true;
    },
  );

  assert.equal(store.listRoadmaps().length, 0, 'no roadmap should be published on methodology failure');
});

test('runPipeline proceeds when the user explicitly chose methodology off (no error)', async () => {
  // lib/skills.js:73 user-chosen off has NO error field.
  const off = { ok: false, source: 'off', skills: {}, totalChars: 0 };
  const dep = stubs({ skills: { loadMethodology: async () => off } });

  const run = await agents.runPipeline('rust', () => {}, dep);
  assert.equal(run.status, 'done');
  assert.equal(run.methodologySource, 'off');
});
