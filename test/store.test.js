'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let store;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-store-'));
  process.env.ROADMAP_FORGE_DATA_DIR = dir;
  delete require.cache[require.resolve('../lib/store')];
  store = require('../lib/store');
});

test('defaults include methodologySource auto and callCharBudget', () => {
  const s = store.loadSettings();
  assert.equal(s.methodologySource, 'auto');
  assert.equal(s.callCharBudget, 24000);
});

test('useMcp false maps to methodologySource off when unset', () => {
  fs.mkdirSync(path.dirname(store.SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(store.SETTINGS_FILE, JSON.stringify({ useMcp: false }));
  const s = store.loadSettings();
  assert.equal(s.methodologySource, 'off');
});

test('saveSettings persists new keys and keeps secrets on empty input', () => {
  store.saveSettings({ apiKey: 'sk-secret', methodologySource: 'local', superpowersPath: 'C:\\skills', callCharBudget: 30000 });
  store.saveSettings({ apiKey: '' });
  const s = store.loadSettings();
  assert.equal(s.apiKey, 'sk-secret');
  assert.equal(s.superpowersPath, 'C:\\skills');
  assert.equal(s.callCharBudget, 30000);
});

test('updateRun patches and persists a run', () => {
  store.saveRun({ id: 'run_test', input: 'x', stage: 'created' });
  const next = store.updateRun('run_test', { stage: 'questions', pendingQuestion: 'Q?' });
  assert.equal(next.pendingQuestion, 'Q?');
  assert.equal(store.getRun('run_test').stage, 'questions');
});

test('summaryOf carries review so the library can show drafts', () => {
  store.saveRoadmap({ id: 'rm_1', title: 'R', createdAt: 1, phases: [], review: { approved: false, score: 7, validation: { valid: false } } });
  const [summary] = store.listRoadmaps();
  assert.equal(summary.review.score, 7);
  assert.equal(summary.review.validation.valid, false);
});
