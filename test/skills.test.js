'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSkills, resolveLocalPath, loadMethodology } = require('../lib/skills');

// Hermeticity: a developer machine may have a real Superpowers install under
// ~/.config/opencode/skills, which would make the "no local dir resolves"
// scenarios below pick up that ambient install instead of exercising their
// intended branch. Point HOME/USERPROFILE at an empty temp dir for this file
// and restore them afterwards. This changes no assertions and no production
// code -- it only controls the test environment.
const REAL_HOME = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const EMPTY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-empty-home-'));
process.env.HOME = EMPTY_HOME;
process.env.USERPROFILE = EMPTY_HOME;
after(() => {
  for (const [key, value] of Object.entries(REAL_HOME)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(EMPTY_HOME, { recursive: true, force: true });
});

function makeSkillsDir({ long = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-skills-'));
  const pad = long ? 'x'.repeat(6000) : '';
  const files = {
    brainstorming: '# Brainstorming\nAsk one question at a time.' + pad,
    'writing-plans': '# Writing Plans\nBite-sized verifiable steps.',
    'using-superpowers': '# Using Superpowers\nLoad the right skill.',
  };
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'SKILL.md'), text);
  }
  return dir;
}

test('readSkills keeps full text, including content beyond 2500 chars', () => {
  const dir = makeSkillsDir({ long: true });
  const loaded = readSkills(dir);
  assert.equal(loaded.source, 'local');
  assert.equal(loaded.skills.brainstorming.chars, loaded.skills.brainstorming.text.length);
  assert.ok(loaded.skills.brainstorming.text.length > 5000);
  assert.equal(loaded.totalChars,
    loaded.skills.brainstorming.chars + loaded.skills.writingPlans.chars + loaded.skills.usingSuperpowers.chars);
});

test('readSkills names the missing skill and path', () => {
  const dir = makeSkillsDir();
  fs.rmSync(path.join(dir, 'writing-plans'), { recursive: true, force: true });
  assert.throws(() => readSkills(dir), /writing-plans.*SKILL\.md/);
});

test('resolveLocalPath prefers SUPERPOWERS_PATH over settings', () => {
  const dir = makeSkillsDir();
  const prev = process.env.SUPERPOWERS_PATH;
  process.env.SUPERPOWERS_PATH = dir;
  try {
    assert.equal(resolveLocalPath({ superpowersPath: 'C:\\nope' }), dir);
  } finally {
    if (prev === undefined) delete process.env.SUPERPOWERS_PATH; else process.env.SUPERPOWERS_PATH = prev;
  }
});

test('loadMethodology local mode fails loudly when the path is missing', async () => {
  const res = await loadMethodology({ methodologySource: 'local', superpowersPath: path.join(os.tmpdir(), 'rf-missing') });
  assert.equal(res.ok, false);
  assert.equal(res.source, 'local');
  assert.match(res.error, /skills/i);
});

test('loadMethodology auto falls back to MCP without truncating', async () => {
  const mcpText = '# Brainstorming\n' + 'y'.repeat(9000);
  const deps = {
    mcp: {
      callTool: async (_url, name) => {
        if (name === 'skill_brainstorming') return mcpText;
        if (name === 'skill_writing_plans') return '# Writing Plans\n' + 'z'.repeat(4000);
        return '# Using Superpowers\nshort';
      },
    },
  };
  const res = await loadMethodology(
    { methodologySource: 'auto', superpowersPath: path.join(os.tmpdir(), 'rf-missing') },
    deps
  );
  assert.equal(res.ok, true);
  assert.equal(res.source, 'mcp');
  assert.equal(res.skills.brainstorming.text.length, mcpText.length);
});

test('loadMethodology auto reports a broken local install instead of silently using MCP', async () => {
  const dir = makeSkillsDir();
  fs.rmSync(path.join(dir, 'writing-plans'), { recursive: true, force: true });
  let mcpCalls = 0;
  const deps = { mcp: { callTool: async () => { mcpCalls++; return 'unexpected'; } } };
  const res = await loadMethodology({ methodologySource: 'auto', superpowersPath: dir }, deps);
  assert.equal(res.ok, false);
  assert.equal(res.source, 'local');
  assert.match(res.error, /writing-plans/);
  assert.equal(mcpCalls, 0);
});

test('loadMethodology off mode returns an explicit off result', async () => {
  const res = await loadMethodology({ methodologySource: 'off' });
  assert.deepEqual({ ok: res.ok, source: res.source, totalChars: res.totalChars }, { ok: false, source: 'off', totalChars: 0 });
});
