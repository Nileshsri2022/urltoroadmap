# Superpowers Interactive Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RoadmapForge ask the user Superpowers-style questions, follow the full installed Superpowers methodology, generate roadmaps of content-driven size with enforced detail, and expose every agent's full output in a tabbed sidebar.

**Architecture:** A new staged pipeline (research → interview → playback → approach → outline → per-phase expand → validate/repair → review → publish) replaces the single-shot Planner call. Local Superpowers `SKILL.md` files are read in full and injected stage-wise; the MCP server is a fallback. Pure modules (`skills`, `validate`, `planner`, `reviewer`, `interview`) keep the orchestrator thin and testable with injected dependencies.

**Tech Stack:** Node.js >= 18, zero npm dependencies, built-in `node:test`/`node:assert`, vanilla HTML/CSS/JS, SSE.

**Spec:** `docs/superpowers/specs/2026-11-19-superpowers-interactive-roadmap-design.md`

## Global Constraints

- Zero npm dependencies; only Node.js built-ins.
- Node.js >= 18; Windows-friendly paths (`path.join`, no POSIX-only shell assumptions).
- Never truncate skill text silently. Full content or an explicit error.
- No fixed phase or step counts anywhere.
- Existing saved roadmaps and runs must keep loading (new fields optional).
- API keys stay masked in every GET response.
- Every user-facing failure names the failing stage and an actionable next step.

## Review Focus

- Provider rejects a large prompt: the run must fail with a clear size/limit message, never hang or silently drop content.
- Refresh or navigation mid-interview: the same pending question resumes; answers are not duplicated.
- Planner omits coverage or detail: deterministic validation catches it, repair fixes it, or the roadmap publishes with a visible "Draft — incomplete" badge.
- Skill path missing or unreadable: `local` mode reports an explicit error; `auto` falls back to MCP only when no local skills directory resolves, and reports the file error when one resolves but is broken; `off` is announced.
- Old run/roadmap files without new fields: pages render without crashing and show empty states.

---

### Task 0: Git baseline and secret ignores

**Files:**
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a repository where `data/settings.json`, saved roadmaps, and runs are never committed.

- [ ] **Step 1: Write `.gitignore`**

```gitignore
node_modules/
data/settings.json
data/roadmaps/
data/runs/
*.log
```

- [ ] **Step 2: Initialize git if needed and commit the baseline**

Run:
```bash
git init
git add -A
git commit -m "chore: baseline before superpowers flow"
```
Expected: commit succeeds. If the repo already exists, only the new commit is created.

- [ ] **Step 3: Verify secrets are ignored**

Run:
```bash
git check-ignore -v data/settings.json data/roadmaps/rm_demo_superpowers.json
git status --short
```
Expected: both paths are reported as ignored; `git status` shows no `data/` files.

---

### Task 1: Skill loader with full local text and MCP fallback

**Files:**
- Create: `lib/skills.js`
- Create: `test/skills.test.js`
- Modify: `lib/mcp.js` (remove the 2,500-char truncation from the legacy `getMethodogy`)
- Modify: `package.json` (add `"test": "node --test"`)

**Interfaces:**
- Consumes: `lib/mcp.js` (`callTool`).
- Produces:
  - `resolveLocalPath(settings) -> string | null`
  - `readSkills(dir) -> { source: 'local', path, skills: { brainstorming, writingPlans, usingSuperpowers }, totalChars }`
  - `loadMethodology(settings, deps?) -> Promise<{ ok, source: 'local'|'mcp'|'off', path?, skills, totalChars, error? }>`
  - `skillChars(skills) -> { brainstorming, writingPlans, usingSuperpowers }`

Skill file contract: each entry is `{ name, file, text, chars }`, where `text` is the complete `SKILL.md` contents.

- [ ] **Step 1: Write the failing tests**

Create `test/skills.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSkills, resolveLocalPath, loadMethodology } = require('../lib/skills');

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/skills.test.js`
Expected: FAIL with `Cannot find module '../lib/skills'`.

- [ ] **Step 3: Implement `lib/skills.js`**

```js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const mcp = require('./mcp');

const SKILL_DIRS = {
  brainstorming: 'brainstorming',
  writingPlans: 'writing-plans',
  usingSuperpowers: 'using-superpowers',
};
const MCP_TOOLS = {
  brainstorming: 'skill_brainstorming',
  writingPlans: 'skill_writing_plans',
};
// Optional: the hosted server may or may not expose this tool name.
const MCP_OPTIONAL = { usingSuperpowers: 'skill_using_superpowers' };

function existsSkills(dir) {
  return Boolean(dir) && fs.existsSync(path.join(dir, 'brainstorming', 'SKILL.md'));
}

function pluginCacheCandidates() {
  const root = path.join(os.homedir(), '.cache', 'opencode', 'npm');
  const out = [];
  try {
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith('git-superpowers-')) continue;
      const base = path.join(root, name);
      for (const stamp of fs.readdirSync(base)) {
        out.push(path.join(base, stamp, 'node_modules', 'superpowers', 'skills'));
      }
    }
  } catch {}
  return out;
}

function resolveLocalPath(settings = {}) {
  const candidates = [
    process.env.SUPERPOWERS_PATH,
    settings.superpowersPath,
    path.join(os.homedir(), '.config', 'opencode', 'skills'),
    ...pluginCacheCandidates(),
  ].filter(Boolean);
  for (const dir of candidates) if (existsSkills(dir)) return dir;
  return null;
}

function readSkills(dir) {
  const skills = {};
  for (const [key, folder] of Object.entries(SKILL_DIRS)) {
    const file = path.join(dir, folder, 'SKILL.md');
    if (!fs.existsSync(file)) throw new Error(`Skill "${folder}" missing: ${file}`);
    const text = fs.readFileSync(file, 'utf8');
    skills[key] = { name: folder, file, text, chars: text.length };
  }
  return { source: 'local', path: dir, skills, totalChars: totalChars(skills) };
}

function totalChars(skills) {
  return Object.values(skills).reduce((n, s) => n + (s.text ? s.text.length : 0), 0);
}

function skillChars(skills) {
  const out = {};
  for (const [key, s] of Object.entries(skills || {})) out[key] = s.chars;
  return out;
}

async function loadMethodology(settings = {}, deps = {}) {
  const source = settings.methodologySource
    || (settings.useMcp === false ? 'off' : 'auto');
  if (source === 'off') return { ok: false, source: 'off', skills: {}, totalChars: 0 };

  if (source === 'local' || source === 'auto') {
    const dir = resolveLocalPath(settings);
    if (dir) {
      try { return { ok: true, ...readSkills(dir) }; }
      catch (e) {
        // A resolved-but-broken local install is reported, never silently replaced by MCP.
        return { ok: false, source: 'local', skills: {}, totalChars: 0, path: dir, error: e.message };
      }
    } else if (source === 'local') {
      return {
        ok: false, source: 'local', skills: {}, totalChars: 0,
        error: 'Superpowers skills not found. Set SUPERPOWERS_PATH or the superpowersPath setting to a folder containing brainstorming/SKILL.md.',
      };
    }
  }

  const client = deps.mcp || mcp;
  try {
    const skills = {};
    for (const [key, tool] of Object.entries(MCP_TOOLS)) {
      const text = await client.callTool(settings.mcpUrl, tool, {});
      skills[key] = { name: SKILL_DIRS[key], file: `mcp:${tool}`, text, chars: text.length };
    }
    for (const [key, tool] of Object.entries(MCP_OPTIONAL)) {
      try {
        const text = await client.callTool(settings.mcpUrl, tool, {});
        if (text) skills[key] = { name: SKILL_DIRS[key], file: `mcp:${tool}`, text, chars: text.length };
      } catch {
        // Optional skill: never fail the whole load because of it.
      }
    }
    return { ok: true, source: 'mcp', skills, totalChars: totalChars(skills) };
  } catch (e) {
    return { ok: false, source: 'off', skills: {}, totalChars: 0, error: `No methodology source: ${e.message}` };
  }
}

module.exports = { resolveLocalPath, readSkills, loadMethodology, skillChars, totalChars };
```

Also in `lib/mcp.js`, remove the per-skill `truncate(..., 2500)` calls inside the legacy `getMethodogy` so that path stops losing content too; drop the now-unused `truncate` helper if nothing else uses it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/skills.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/skills.js test/skills.test.js lib/mcp.js package.json
git commit -m "feat: load full superpowers skills with mcp fallback"
```

---

### Task 2: Deterministic roadmap validator

**Files:**
- Create: `lib/validate.js`
- Create: `test/validate.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeTerm(s) -> string`
  - `validateRoadmap(roadmap, research) -> { valid, errors, coverage }`
  - Error shape: `{ code, path, message, missing? }`

- [ ] **Step 1: Write the failing tests**

Create `test/validate.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeTerm, validateRoadmap } = require('../lib/validate');

const research = {
  keyConcepts: ['Ownership', 'Borrowing', 'Lifetimes'],
  pitfalls: ['Fighting the borrow checker too late'],
};

function roadmap(overrides = {}) {
  return {
    title: 'Rust',
    phases: [{
      id: 'p1', title: 'Foundations', goal: 'Own the basics',
      miniProject: 'Build a CLI', checklist: ['Can explain moves', 'Can explain borrows'],
      covers: ['Ownership', 'Borrowing'],
      steps: [{
        id: 'p1s1', title: 'Read chapter 4',
        detail: 'Read the ownership chapter and type every example yourself, then explain moves, clones and drops in your own words.',
        hours: 4, verify: 'Explain move vs clone without notes',
        covers: ['Ownership'], addressesPitfalls: ['Fighting the borrow checker too late'],
        resources: [],
      }],
    }, {
      id: 'p2', title: 'Lifetimes', goal: 'Use lifetimes',
      miniProject: 'Build a parser', checklist: ['Can annotate a struct'],
      covers: ['Lifetimes'],
      steps: [{
        id: 'p2s1', title: 'Annotate lifetimes',
        detail: 'Annotate three functions with explicit lifetimes, then remove each annotation one at a time and explain out loud why the compiler accepts or rejects it.',
        hours: 3, verify: 'Annotate a struct without compiler help',
        covers: ['Lifetimes'], addressesPitfalls: [], resources: [],
      }],
    }],
    ...overrides,
  };
}

test('normalizeTerm trims, lowercases, collapses whitespace', () => {
  assert.equal(normalizeTerm('  Fight   THE  Borrow '), 'fight the borrow');
});

test('validateRoadmap accepts a complete roadmap', () => {
  const res = validateRoadmap(roadmap(), research);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
  assert.equal(res.coverage.concepts.covered, 3);
  assert.equal(res.coverage.pitfalls.covered, 1);
});

test('validateRoadmap reports missing coverage with verbatim values', () => {
  const rm = roadmap();
  rm.phases[1].covers = [];
  rm.phases[1].steps[0].covers = [];
  const res = validateRoadmap(rm, research);
  assert.equal(res.valid, false);
  const err = res.errors.find((e) => e.code === 'missing-concepts');
  assert.deepEqual(err.missing, ['Lifetimes']);
});

test('validateRoadmap enforces detail, hours, verify and checklist', () => {
  const rm = roadmap();
  rm.phases[0].steps[0].detail = 'short';
  rm.phases[0].steps[0].hours = 0;
  rm.phases[0].steps[0].verify = '';
  rm.phases[0].checklist = ['one'];
  const codes = validateRoadmap(rm, research).errors.map((e) => e.code).sort();
  assert.deepEqual(codes, ['bad-checklist', 'bad-detail', 'bad-hours', 'bad-verify']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/validate.test.js`
Expected: FAIL with `Cannot find module '../lib/validate'`.

- [ ] **Step 3: Implement `lib/validate.js`**

```js
'use strict';

function normalizeTerm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function allCovers(roadmap) {
  const out = [];
  for (const p of roadmap.phases || []) {
    for (const c of p.covers || []) out.push(normalizeTerm(c));
    for (const s of p.steps || []) for (const c of s.covers || []) out.push(normalizeTerm(c));
  }
  return new Set(out);
}

function allPitfalls(roadmap) {
  const out = [];
  for (const p of roadmap.phases || []) {
    for (const s of p.steps || []) for (const c of s.addressesPitfalls || []) out.push(normalizeTerm(c));
  }
  return new Set(out);
}

function validateRoadmap(roadmap, research = {}) {
  const errors = [];
  const phases = Array.isArray(roadmap.phases) ? roadmap.phases : [];
  if (phases.length < 2) {
    errors.push({ code: 'too-few-phases', path: '$.phases', message: 'Roadmap needs at least two phases.' });
  }

  phases.forEach((p, pi) => {
    const pPath = `$.phases[${pi}]`;
    if (!String(p.goal || '').trim()) errors.push({ code: 'missing-goal', path: `${pPath}.goal`, message: 'Phase goal is required.' });
    if (!String(p.miniProject || '').trim()) errors.push({ code: 'missing-miniproject', path: `${pPath}.miniProject`, message: 'Phase miniProject is required.' });
    if (!Array.isArray(p.checklist) || p.checklist.length < 2) {
      errors.push({ code: 'bad-checklist', path: `${pPath}.checklist`, message: 'Phase needs at least two checklist items.' });
    }
    if (!Array.isArray(p.steps) || !p.steps.length) {
      errors.push({ code: 'empty-phase', path: `${pPath}.steps`, message: 'Phase needs at least one step.' });
    }
    (p.steps || []).forEach((s, si) => {
      const sPath = `${pPath}.steps[${si}]`;
      if (!String(s.title || '').trim()) errors.push({ code: 'missing-title', path: `${sPath}.title`, message: 'Step title is required.' });
      if (String(s.detail || '').trim().length < 120) {
        errors.push({ code: 'bad-detail', path: `${sPath}.detail`, message: 'Step detail must be at least 120 characters and concrete.' });
      }
      if (!Number.isFinite(Number(s.hours)) || Number(s.hours) <= 0) {
        errors.push({ code: 'bad-hours', path: `${sPath}.hours`, message: 'Step hours must be a positive number.' });
      }
      if (!String(s.verify || '').trim()) {
        errors.push({ code: 'bad-verify', path: `${sPath}.verify`, message: 'Step verify self-check is required.' });
      }
    });
  });

  const covered = allCovers(roadmap);
  const concepts = (research.keyConcepts || []).map((c) => String(c));
  const missingConcepts = concepts.filter((c) => !covered.has(normalizeTerm(c)));
  if (missingConcepts.length) {
    errors.push({ code: 'missing-concepts', path: '$.phases', message: 'Research concepts are not covered.', missing: missingConcepts });
  }

  const addressed = allPitfalls(roadmap);
  const pitfalls = (research.pitfalls || []).map((p) => String(p));
  const missingPitfalls = pitfalls.filter((p) => !addressed.has(normalizeTerm(p)));
  if (missingPitfalls.length) {
    errors.push({ code: 'missing-pitfalls', path: '$.phases', message: 'Research pitfalls are not addressed.', missing: missingPitfalls });
  }

  return {
    valid: errors.length === 0,
    errors,
    coverage: {
      concepts: { total: concepts.length, covered: concepts.length - missingConcepts.length, missing: missingConcepts },
      pitfalls: { total: pitfalls.length, covered: pitfalls.length - missingPitfalls.length, missing: missingPitfalls },
    },
  };
}

module.exports = { normalizeTerm, validateRoadmap };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/validate.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validate.js test/validate.test.js
git commit -m "feat: deterministic roadmap detail and coverage validation"
```

---

### Task 3: JSON chat helper and planner module

**Files:**
- Modify: `lib/llm.js` (add `chatJson`)
- Create: `lib/planner.js`
- Create: `test/planner.test.js`

**Interfaces:**
- Consumes: `llm.chat`, `llm.extractJson`.
- Produces:
  - `llm.chatJson(settings, system, user, deps?) -> Promise<object>`
  - `outline(settings, ctx, deps?) -> Promise<outline>`
  - `expandPhase(settings, ctx, outline, phase, deps?) -> Promise<phase>`
  - `mergeRoadmap(outline, expandedPhases) -> roadmap`
  - `repairPhase(settings, ctx, phase, errors, deps?) -> Promise<phase>`
  - `estimateChars(value) -> number`

`ctx` shape: `{ input, research, interview: { answers, playback, approach }, methodology }`.
`deps` shape: `{ chatJson }` where `chatJson(settings, system, user) -> Promise<object>`; it defaults to `llm.chatJson`.

- [ ] **Step 1: Write the failing tests**

Create `test/planner.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/planner.test.js`
Expected: FAIL with `Cannot find module '../lib/planner'`.

- [ ] **Step 3: Add `chatJson` to `lib/llm.js`**

Append before `module.exports`:

```js
async function chatJson(settings, system, user, deps = {}) {
  const chatFn = deps.chat || chat;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let raw = '';
  try {
    raw = await chatFn(settings, messages);
    return extractJson(raw);
  } catch (first) {
    const repair = [
      ...messages,
      { role: 'assistant', content: String(raw || '').slice(0, 8000) },
      { role: 'user', content: `Invalid JSON (${first.message}). Return the corrected JSON object only.` },
    ];
    return extractJson(await chatFn(settings, repair));
  }
}
```

Export it: `module.exports = { chat, chatJson, extractJson, completionsUrl };`

- [ ] **Step 4: Implement `lib/planner.js`**

```js
'use strict';
const llm = require('./llm');

const OUTLINE_SCHEMA = `{
  "title": "string", "emoji": "single emoji", "summary": "2-3 sentences",
  "difficulty": "beginner | intermediate | advanced",
  "estimatedDuration": "string",
  "principles": ["3-5 topic-specific principles"],
  "milestoneProject": "one capstone project",
  "phases": [{ "id": "p1", "title": "string", "goal": "what the learner can DO",
    "duration": "string", "skills": ["3-5 skills"], "stepTitles": ["one concrete action per step"] }]
}`;

const PHASE_SCHEMA = `{
  "id": "same id as the outline phase", "title": "string", "goal": "string",
  "duration": "string", "skills": ["string"],
  "miniProject": "a small concrete build",
  "checklist": ["2-4 checkpoint questions"],
  "covers": ["exact research.keyConcepts covered by this phase"],
  "steps": [{ "id": "p1s1", "title": "imperative action",
    "detail": "4-6 sentences of concrete guidance: what to do, in what order, why it matters",
    "hours": 3, "verify": "one concrete self-check",
    "covers": ["exact research.keyConcepts covered by this step"],
    "addressesPitfalls": ["exact research.pitfalls addressed by this step"],
    "resources": [{ "label": "resource", "url": "https://..." }] }]
}`;

function estimateChars(value) { return JSON.stringify(value).length; }

function methodologyText(methodology, key) {
  return (methodology && methodology.skills && methodology.skills[key] && methodology.skills[key].text) || '';
}

function contextBlock(ctx) {
  const parts = [];
  if (ctx.input) parts.push(`Task: "${ctx.input}"`);
  if (ctx.research) parts.push(`<research>\n${JSON.stringify(ctx.research, null, 1)}\n</research>`);
  if (ctx.interview) parts.push(`<interview>\n${JSON.stringify(ctx.interview, null, 1)}\n</interview>`);
  return parts.join('\n\n');
}

async function outline(settings, ctx, deps = {}) {
  const system = [
    'You are AGENT-2 "Planner". Produce the outline of a learning roadmap.',
    'Follow the Superpowers writing-plans methodology below in full. It is a methodology, not a limit: emit as many phases and steps as the subject genuinely needs.',
    methodologyText(ctx.methodology, 'writingPlans'),
    'Rules: content decides phase and step counts. Every phase must end with something the learner can build or demonstrate. Every step is one concrete action. Cover every research keyConcept and pitfall somewhere.',
    'Respond with ONLY one valid JSON object matching this schema:',
    OUTLINE_SCHEMA,
  ].filter(Boolean).join('\n\n');
  const chatJson = deps.chatJson || llm.chatJson;
  return chatJson(settings, system, contextBlock(ctx) + '\n\nProduce the outline JSON now.', deps);
}

async function expandPhase(settings, ctx, outlineObj, phase, deps = {}) {
  const system = [
    'You are AGENT-2 "Planner". Expand ONE phase of an existing roadmap outline into fully detailed steps.',
    'Follow the Superpowers writing-plans methodology below in full: bite-sized verifiable steps, dependency order, concrete outputs.',
    methodologyText(ctx.methodology, 'writingPlans'),
    'Use the exact strings from research.keyConcepts and research.pitfalls in the covers / addressesPitfalls arrays.',
    'Never invent URLs; omit a resource instead.',
    'Respond with ONLY one valid JSON object matching this schema:',
    PHASE_SCHEMA,
  ].filter(Boolean).join('\n\n');
  const user = [
    contextBlock(ctx),
    `<outline>\n${JSON.stringify(outlineObj, null, 1)}\n</outline>`,
    `Expand this phase only: ${JSON.stringify(phase)}`,
    'Produce the expanded phase JSON now.',
  ].join('\n\n');
  const chatJson = deps.chatJson || llm.chatJson;
  const expanded = await chatJson(settings, system, user, deps);
  return { ...phase, ...expanded, id: phase.id };
}

function mergeRoadmap(outlineObj, expandedPhases) {
  const byId = new Map((expandedPhases || []).map((p) => [p.id, p]));
  return {
    ...outlineObj,
    phases: (outlineObj.phases || []).map((p, i) => {
      const expanded = byId.get(p.id) || (expandedPhases || [])[i] || {};
      return {
        ...p,
        ...expanded,
        id: p.id,
        title: expanded.title || p.title,
        goal: expanded.goal || p.goal,
        steps: (expanded.steps || []).map((s, si) => ({
          ...s,
          id: s.id || `${p.id}_${si + 1}`,
        })),
      };
    }),
  };
}

async function repairPhase(settings, ctx, phase, errors, deps = {}) {
  const system = [
    'You are AGENT-2 "Planner". Repair ONE phase so it passes validation.',
    methodologyText(ctx.methodology, 'writingPlans'),
    'Return the corrected phase JSON only, preserving valid content.',
  ].filter(Boolean).join('\n\n');
  const user = [
    contextBlock(ctx),
    `<phase>\n${JSON.stringify(phase, null, 1)}\n</phase>`,
    '<errors>\n' + JSON.stringify(errors, null, 1) + '\n</errors>',
    'Produce the corrected phase JSON now.',
  ].join('\n\n');
  const chatJson = deps.chatJson || llm.chatJson;
  return chatJson(settings, system, user, deps);
}

module.exports = { outline, expandPhase, mergeRoadmap, repairPhase, estimateChars, OUTLINE_SCHEMA, PHASE_SCHEMA };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/planner.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/llm.js lib/planner.js test/planner.test.js
git commit -m "feat: outline and per-phase expansion planner"
```

---

### Task 4: Chunked reviewer

**Files:**
- Create: `lib/reviewer.js`
- Create: `test/reviewer.test.js`

**Interfaces:**
- Consumes: `llm.chatJson`.
- Produces:
  - `review(settings, ctx, deps?) -> Promise<review>`
  - `aggregateReviews(reviews) -> review`
  - `chunkPhases(phases, maxChars) -> phase[][]`
  - Review shape: `{ approved, score, checklist, issues, chunks? }`

- [ ] **Step 1: Write the failing tests**

Create `test/reviewer.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/reviewer.test.js`
Expected: FAIL with `Cannot find module '../lib/reviewer'`.

- [ ] **Step 3: Implement `lib/reviewer.js`**

```js
'use strict';
const llm = require('./llm');

const REVIEW_SCHEMA = `{
  "approved": true | false,
  "score": 1-10,
  "checklist": [{ "item": "string", "passed": true|false, "note": "one line" }],
  "issues": [{ "phaseId": "the phase this belongs to, or null for a global issue", "problem": "what is wrong", "fix": "exact correction" }]
}`;

function estimate(value) { return JSON.stringify(value).length; }

function chunkPhases(phases, maxChars) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const phase of phases || []) {
    const n = estimate(phase);
    if (current.length && size + n > maxChars) { chunks.push(current); current = []; size = 0; }
    current.push(phase);
    size += n;
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

function aggregateReviews(reviews) {
  const issues = reviews.flatMap((r) => r.issues || []);
  const checklist = reviews.flatMap((r) => r.checklist || []);
  const scores = reviews.map((r) => Number(r.score) || 0).filter((n) => n > 0);
  return {
    approved: reviews.every((r) => r.approved === true),
    score: scores.length ? Math.min(...scores) : 1,
    checklist,
    issues,
    chunks: reviews,
  };
}

function systemPrompt() {
  return [
    'You are AGENT-3 "Reviewer" (QA) in a roadmap pipeline. Verify the roadmap and either approve it or send precise corrections back to the Planner.',
    'Check: (1) completeness — every research keyConcept/pitfall is covered and the covers arrays are honest; (2) source fidelity; (3) missing requirements; (4) dependencies — no step requires a later step; (5) sequencing — fundamentals before advanced.',
    'Be strict but pragmatic: approve if the roadmap is genuinely usable; reject with concrete fixes otherwise. Score honestly out of 10.',
    'Every issue must set phaseId when it belongs to one phase; use null only for a global issue.',
    'Respond with ONLY one valid JSON object matching this schema:',
    REVIEW_SCHEMA,
  ].join('\n');
}

async function review(settings, ctx, deps = {}) {
  const chatJson = deps.chatJson || llm.chatJson;
  const budget = Number(settings.callCharBudget) > 0 ? Number(settings.callCharBudget) : 24000;
  const roadmap = ctx.roadmap || {};
  const full = estimate(roadmap);
  if (full <= budget) {
    const user = [
      `<task>${ctx.input}</task>`,
      `<research>${JSON.stringify(ctx.research || {})}</research>`,
      `<roadmap>${JSON.stringify(roadmap)}</roadmap>`,
      'Produce the Review JSON now.',
    ].join('\n');
    return chatJson(settings, systemPrompt(), user, deps);
  }
  const chunks = chunkPhases(roadmap.phases || [], Math.max(2000, Math.floor(budget * 0.7)));
  const perChunk = [];
  for (const chunk of chunks) {
    const user = [
      `<task>${ctx.input}</task>`,
      `<research>${JSON.stringify(ctx.research || {})}</research>`,
      `<roadmap>${JSON.stringify({ ...roadmap, phases: chunk })}</roadmap>`,
      'Review this phase batch. Produce the Review JSON now.',
    ].join('\n');
    perChunk.push(await chatJson(settings, systemPrompt(), user, deps));
  }
  const globalUser = [
    `<task>${ctx.input}</task>`,
    `<outline>${JSON.stringify({ title: roadmap.title, phases: (roadmap.phases || []).map(({ id, title, goal, steps }) => ({ id, title, goal, stepTitles: (steps || []).map((s) => s.title) })) })}</outline>`,
    'Check cross-phase dependency order and sequencing only. Produce the Review JSON now.',
  ].join('\n');
  perChunk.push(await chatJson(settings, systemPrompt(), globalUser, deps));
  return aggregateReviews(perChunk);
}

module.exports = { review, aggregateReviews, chunkPhases, REVIEW_SCHEMA };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/reviewer.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/reviewer.js test/reviewer.test.js
git commit -m "feat: chunked reviewer with aggregated approval"
```

---

### Task 5: Interview module

**Files:**
- Create: `lib/interview.js`
- Create: `test/interview.test.js`

**Interfaces:**
- Consumes: `llm.chatJson`.
- Produces:
  - `MAX_QUESTIONS = 6`
  - `nextQuestion(settings, ctx, deps?) -> Promise<{ done, question? }>`
  - `playback(settings, ctx, deps?) -> Promise<{ summary, bullets, openQuestions }>`
  - `approaches(settings, ctx, deps?) -> Promise<{ approaches, recommendedId }>`

- [ ] **Step 1: Write the failing tests**

Create `test/interview.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const interview = require('../lib/interview');

const methodology = { skills: { brainstorming: { text: '# Brainstorming\nAsk one question at a time.', chars: 40 } } };

test('nextQuestion sends the full brainstorming skill and returns a question', async () => {
  let seen = '';
  const deps = { chatJson: async (_s, system) => { seen = system; return { done: false, question: 'What is your level?' }; } };
  const out = await interview.nextQuestion({}, { input: 'rust', research: {}, answers: [], methodology }, deps);
  assert.equal(out.question, 'What is your level?');
  assert.ok(seen.includes('# Brainstorming'));
  assert.ok(seen.includes('Ask one question at a time.'));
});

test('nextQuestion stops at MAX_QUESTIONS without calling the model', async () => {
  let calls = 0;
  const deps = { chatJson: async () => { calls++; return { done: false, question: 'more?' }; } };
  const answers = Array.from({ length: interview.MAX_QUESTIONS }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
  const out = await interview.nextQuestion({}, { input: 'rust', research: {}, answers, methodology }, deps);
  assert.equal(out.done, true);
  assert.equal(calls, 0);
});

test('approaches keeps 2-3 options and a valid recommendation', async () => {
  const deps = { chatJson: async () => ({
    approaches: [
      { id: 'project-first', title: 'Project first', description: 'd', tradeoffs: 't' },
      { id: 'theory-first', title: 'Theory first', description: 'd', tradeoffs: 't' },
      { id: 'extra', title: 'Extra', description: 'd', tradeoffs: 't' },
      { id: 'fourth', title: 'Fourth', description: 'd', tradeoffs: 't' },
    ],
    recommendedId: 'nope',
  }) };
  const out = await interview.approaches({}, { input: 'rust', research: {}, answers: [], methodology }, deps);
  assert.equal(out.approaches.length, 3);
  assert.ok(out.approaches.some((a) => a.id === out.recommendedId));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/interview.test.js`
Expected: FAIL with `Cannot find module '../lib/interview'`.

- [ ] **Step 3: Implement `lib/interview.js`**

```js
'use strict';
const llm = require('./llm');

const MAX_QUESTIONS = 12; // safety bound only: the model decides when it has enough

function skillText(methodology) {
  return (methodology && methodology.skills && methodology.skills.brainstorming && methodology.skills.brainstorming.text) || '';
}

function baseSystem(extra) {
  return [
    'You are the Interviewer for RoadmapForge. Follow the Superpowers brainstorming methodology below in full.',
    skillText(extra.methodology),
    'Ask exactly ONE question at a time. Questions must be specific to the topic and to the previous answers. Never ask for information already given.',
    'Stop as soon as you can plan a genuinely detailed roadmap. Do not pad the interview with low-value questions.',
    'Respond with ONLY one valid JSON object.',
  ].filter(Boolean).join('\n\n');
}

function transcript(ctx) {
  const answers = (ctx.answers || []).map((a, i) => `Q${i + 1}: ${a.q}\nA${i + 1}: ${a.a}`).join('\n\n');
  return `<input>${ctx.input}</input>\n<research>${JSON.stringify(ctx.research || {})}</research>\n<answers>\n${answers}\n</answers>`;
}

async function nextQuestion(settings, ctx, deps = {}) {
  if ((ctx.answers || []).length >= MAX_QUESTIONS) return { done: true };
  const chatJson = deps.chatJson || llm.chatJson;
  const system = baseSystem(ctx) + '\n\nSchema: { "done": boolean, "question": "one sentence" }';
  const user = transcript(ctx) + '\n\nDecide whether you have enough to plan. If not, ask the single most important next question. Produce the JSON now.';
  const out = await chatJson(settings, system, user, deps);
  if (!out || out.done === true || !out.question) return { done: true };
  return { done: false, question: String(out.question).slice(0, 400) };
}

async function playback(settings, ctx, deps = {}) {
  const chatJson = deps.chatJson || llm.chatJson;
  const system = baseSystem(ctx)
    + '\n\nPlay the understanding back to the user in 3-5 sentences, then list any open questions.'
    + '\nSchema: { "summary": "string", "bullets": ["3-6 key points"], "openQuestions": ["string"] }';
  const out = await chatJson(settings, system, transcript(ctx) + '\n\nProduce the playback JSON now.', deps);
  return {
    summary: String(out.summary || ''),
    bullets: (out.bullets || []).map(String).slice(0, 8),
    openQuestions: (out.openQuestions || []).map(String).slice(0, 5),
  };
}

async function approaches(settings, ctx, deps = {}) {
  const chatJson = deps.chatJson || llm.chatJson;
  const system = baseSystem(ctx)
    + '\n\nPropose 2-3 genuinely different learning approaches, grounded in the topic and the answers. Say what each trades off.'
    + '\nSchema: { "approaches": [{ "id": "kebab-id", "title": "string", "description": "string", "tradeoffs": "string" }], "recommendedId": "kebab-id" }';
  const out = await chatJson(settings, system, transcript(ctx) + '\n\nProduce the approaches JSON now.', deps);
  const list = (out.approaches || []).map((a) => ({
    id: String(a.id || '').trim() || 'approach',
    title: String(a.title || ''),
    description: String(a.description || ''),
    tradeoffs: String(a.tradeoffs || ''),
  })).slice(0, 3);
  const recommendedId = list.some((a) => a.id === out.recommendedId) ? out.recommendedId : (list[0] && list[0].id);
  return { approaches: list, recommendedId };
}

module.exports = { MAX_QUESTIONS, nextQuestion, playback, approaches };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/interview.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/interview.js test/interview.test.js
git commit -m "feat: superpowers interview, playback and approaches"
```

---

### Task 6: Store and settings extensions

**Files:**
- Modify: `lib/store.js`
- Create: `test/store.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DATA_DIR` overridable with `process.env.ROADMAP_FORGE_DATA_DIR`.
  - Settings keys: `methodologySource`, `superpowersPath`, `callCharBudget`.
  - `saveRun(run)` / `getRun(id)` unchanged.
  - `updateRun(id, patch) -> run | null`.
  - `summaryOf(rm)` includes `review` so the library card can show approval and draft state.

- [ ] **Step 1: Write the failing tests**

Create `test/store.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/store.test.js`
Expected: FAIL — `methodologySource` is undefined / `updateRun` is not a function.

- [ ] **Step 3: Implement the changes in `lib/store.js`**

- Change `DATA_DIR` to:

```js
const DATA_DIR = process.env.ROADMAP_FORGE_DATA_DIR || path.join(__dirname, '..', 'data');
```

- Extend `DEFAULT_SETTINGS`:

```js
methodologySource: 'auto',
superpowersPath: '',
callCharBudget: 24000,
```

- In `loadSettings`, after merge:

```js
if (!rawHasMethodology) {
  merged.methodologySource = merged.useMcp === false ? 'off' : 'auto';
}
```

Implementation detail: parse raw first, then merge; detect `Object.prototype.hasOwnProperty.call(raw, 'methodologySource')`.

- In `saveSettings`, add `methodologySource`, `superpowersPath`, `callCharBudget` to the string/number copy loop; validate `methodologySource` against `['auto','local','mcp','off']` and `callCharBudget` as a positive integer.
- Add:

```js
function updateRun(id, patch) {
  const run = getRun(id);
  if (!run) return null;
  const next = { ...run, ...(patch || {}) };
  saveRun(next);
  return next;
}
```

- Export `SETTINGS_FILE` (for tests) and `updateRun`.
- Add `review: rm.review` to the object returned by `summaryOf`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/store.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/store.js test/store.test.js
git commit -m "feat: methodology settings and run update helper"
```

---

### Task 7: Staged generation pipeline (one-shot)

**Files:**
- Modify: `lib/agents.js`
- Create: `test/agents.test.js`

**Interfaces:**
- Consumes: `store`, `llm`, `skills`, `planner`, `validate`, `reviewer`, `interview`.
- Produces:
  - `runPipeline(input, emit, deps?) -> Promise<run>` (one-shot path)
  - `runGeneration(runOrId, emit, deps?) -> Promise<run>`
  - `newRun(input)` extended with `stage`, `answers`, `pendingQuestion`, `questionIndex`, `playback`, `approaches`, `chosenApproach`, `validation`, `repairs`, an `interviewer` agent entry, and `artifacts.interview` / `artifacts.outline`.
  - `publicRun(run)` unchanged shape.
  - SSE events: `stage`, `agent`, `log`, `artifact`, `done`, `error`.

- [ ] **Step 1: Write the failing test**

Create `test/agents.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/agents.test.js`
Expected: FAIL — `runPipeline` does not accept deps / timings are null.

- [ ] **Step 3: Refactor `lib/agents.js`**

- Add `resolveDeps`:

```js
function resolveDeps(overrides = {}) {
  return {
    llm: require('./llm'),
    skills: require('./skills'),
    planner: require('./planner'),
    reviewer: require('./reviewer'),
    validate: require('./validate'),
    interview: require('./interview'),
    research: defaultResearch,
    ...overrides,
  };
}
```

`async function defaultResearch(settings, input, log)` moves the existing researcher block from `runPipeline` verbatim — Composio scrape when a token exists, native fetch for links, topic mode otherwise — and returns the research report object. It must not call `artifactEvent()` or `agentEvent()`; the orchestrator does that. The report keeps `research.sources`.

- Add module-level helpers (they replace the closures currently inside `runPipeline`):

```js
let methodologyCache = new Map();
const activeGenerations = new Set();

async function getMethodology(deps, settings, runId) {
  if (runId && methodologyCache.has(runId)) return methodologyCache.get(runId);
  const value = await deps.skills.loadMethodology(settings);
  if (value.ok && runId) methodologyCache.set(runId, value);
  return value;
}

function agentEvent(run, emit, key, status, detail) {
  const agent = run.agents[key];
  if (!agent) return;
  if (status) {
    agent.status = status;
    if (status === 'working' || status === 'revising') agent.endedAt = null;
    if (status !== 'waiting' && !agent.startedAt) agent.startedAt = Date.now();
    if (status === 'done' || status === 'error' || status === 'revising-requested') agent.endedAt = Date.now();
  }
  if (detail !== undefined) agent.detail = String(detail).slice(0, 300);
  store.saveRun(run);
  if (emit) emit({ type: 'agent', id: key, status: agent.status, detail: agent.detail });
}

function logTo(run, agent, message, emit) {
  const entry = { agent, message: String(message).slice(0, 500), ts: Date.now() };
  if (agent === 'orchestrator') {
    run.orchestratorLog = run.orchestratorLog || [];
    run.orchestratorLog.push(entry);
  } else if (run.agents[agent]) {
    run.agents[agent].logs = run.agents[agent].logs || [];
    run.agents[agent].logs.push(entry);
  }
  store.saveRun(run);
  if (emit) emit({ type: 'log', ...entry });
}

function artifactEvent(run, emit, kind, data) {
  run.artifacts[kind] = data;
  store.saveRun(run);
  if (emit) emit({ type: 'artifact', kind, runId: run.id });
}

function phasesForErrors(roadmap, errors) {
  const idx = new Set();
  for (const e of errors || []) {
    const m = /^\$\.phases\[(\d+)\]/.exec(e.path || '');
    if (m && roadmap.phases[Number(m[1])]) idx.add(Number(m[1]));
  }
  if (!idx.size) for (let i = 0; i < (roadmap.phases || []).length; i++) idx.add(i);
  return [...idx];
}

function reviewErrorsForPhase(issues, phaseId) {
  return (issues || [])
    .filter((i) => !i.phaseId || i.phaseId === phaseId)
    .map((i) => ({ path: `phase ${phaseId}`, message: `${i.problem} → ${i.fix}` }));
}

function normalizeRoadmap(roadmap) {
  return { ...roadmap, phases: normalizePhases(roadmap.phases) };
}

async function failRun(run, emit, e) {
  run.status = 'failed';
  run.stage = 'failed';
  run.error = e.message;
  store.saveRun(run);
  logTo(run, 'orchestrator', `Pipeline failed: ${e.message}`, emit);
  emit({ type: 'error', message: e.message });
}
```

- Extend `newRun` with:

```js
stage: 'created',
error: null,
answers: [],
pendingQuestion: null,
questionIndex: 0,
playback: null,
approaches: [],
recommendedApproachId: null,
chosenApproach: null,
validation: null,
repairs: 0,
```

Also add to `agents`:

```js
interviewer: { label: 'Interviewer', icon: '💬', mcp: 'Superpowers brainstorming', status: 'waiting', tool: 'skill_brainstorming', detail: '', logs: [], startedAt: null, endedAt: null },
```

and extend `artifacts` to `{ research: null, interview: null, outline: null, roadmapDraft: null, review: null, roadmap: null }`.

- Implement `runGeneration` as:

```js
async function runGeneration(runOrId, emit, deps = {}) {
  const d = resolveDeps(deps);
  let run = typeof runOrId === 'string' ? store.getRun(runOrId) : runOrId;
  if (!run) throw new Error('Run not found');
  if (activeGenerations.has(run.id)) throw new Error('Generation already running for this run');
  activeGenerations.add(run.id);
  run.stage = 'generating';
  run.status = 'running';
  run.error = null;
  run.rounds = 0;
  run.repairs = 0;
  store.saveRun(run);
  emit({ type: 'run', run: publicRun(run) });

  try {
    const settings = store.loadSettings();
    if (!settings.apiKey || !settings.baseUrl || !settings.model) throw new Error('Configure your AI settings first (Base URL, API key, Model)');

    const methodology = await getMethodology(d, settings, run.id);
    run.methodologySource = methodology.source;
    run.methodologyChars = methodology.totalChars;
    if (methodology.ok === false && methodology.source !== 'off') throw new Error(methodology.error || 'Methodology could not be loaded');
    logTo(run, 'orchestrator', `Methodology: ${methodology.source}${methodology.path ? ' — ' + methodology.path : ''} (${methodology.totalChars} chars)`, emit);
    emit({ type: 'stage', stage: 'methods', source: methodology.source, totalChars: methodology.totalChars });

    const ctx = {
      input: run.input,
      research: run.artifacts.research,
      interview: { answers: run.answers, playback: run.playback, chosenApproach: run.chosenApproach },
      methodology,
    };

    agentEvent(run, emit, 'planner', 'working', 'Planning the outline');
    const outline = await d.planner.outline(settings, ctx, d);
    artifactEvent(run, emit, 'outline', outline);

    const expanded = [];
    for (let i = 0; i < (outline.phases || []).length; i++) {
      const phase = outline.phases[i];
      emit({ type: 'stage', stage: 'expand', phase: phase.id, index: i + 1, total: outline.phases.length });
      expanded.push(await d.planner.expandPhase(settings, ctx, outline, phase, d));
      run.artifacts.roadmapDraft = d.planner.mergeRoadmap(outline, expanded);
      store.saveRun(run);
      emit({ type: 'artifact', kind: 'roadmapDraft', runId: run.id });
    }

    let roadmap = normalizeRoadmap(d.planner.mergeRoadmap(outline, expanded));
    let review = null;
    let validation = null;

    for (let round = 1; round <= 2; round++) {
      run.rounds = round;
      if (round > 1) {
        const phases = [];
        for (const phase of roadmap.phases) {
          const errors = reviewErrorsForPhase(review && review.issues, phase.id);
          phases.push(errors.length ? await d.planner.repairPhase(settings, ctx, phase, errors, d) : phase);
        }
        roadmap = normalizeRoadmap(d.planner.mergeRoadmap(roadmap, phases));
        emit({ type: 'stage', stage: 'revise', round });
      }

      let repairs = 0;
      validation = d.validate.validateRoadmap(roadmap, ctx.research);
      run.validation = validation;
      store.saveRun(run);
      emit({ type: 'stage', stage: 'validate', round, valid: validation.valid, errors: validation.errors.length });

      while (!validation.valid && repairs < 2) {
        repairs++;
        run.repairs++;
        const repaired = [];
        for (const i of phasesForErrors(roadmap, validation.errors)) {
          repaired[i] = await d.planner.repairPhase(settings, ctx, roadmap.phases[i], validation.errors, d);
        }
        roadmap = normalizeRoadmap(d.planner.mergeRoadmap(roadmap, roadmap.phases.map((p, i) => repaired[i] || p)));
        validation = d.validate.validateRoadmap(roadmap, ctx.research);
        run.validation = validation;
        run.artifacts.roadmapDraft = roadmap;
        store.saveRun(run);
        emit({ type: 'artifact', kind: 'roadmapDraft', runId: run.id });
        emit({ type: 'stage', stage: 'repair', round, repairs, valid: validation.valid });
      }

      agentEvent(run, emit, 'reviewer', 'working', 'Checking completeness, sources and sequencing');
      review = await d.reviewer.review(settings, { ...ctx, roadmap }, d);
      artifactEvent(run, emit, 'review', review);
      agentEvent(run, emit, 'reviewer', review.approved ? 'done' : 'revising-requested',
        review.approved ? `Approved — ${review.score}/10` : `Corrections requested (${(review.issues || []).length})`);

      if (review.approved || !validation.valid) break;
    }

    agentEvent(run, emit, 'planner', 'done', roadmap.title);

    const approved = Boolean(review && review.approved && validation && validation.valid);
    const saved = {
      ...roadmap,
      id: store.newId(),
      source: {
        type: extract.isUrl(run.input) ? 'link' : 'topic',
        value: run.input,
        title: (ctx.research && ctx.research.topic) || run.input,
        description: '',
      },
      model: settings.model,
      methodologySource: methodology.source,
      methodologyChars: methodology.totalChars,
      mcpUsed: methodology.source === 'local' || methodology.source === 'mcp',
      review: {
        ...(review || {}),
        approved,
        reviewerApproved: Boolean(review && review.approved),
        validation,
      },
      createdAt: Date.now(),
      progress: {},
    };
    store.saveRoadmap(saved);
    run.finalRoadmapId = saved.id;
    run.approved = approved;
    run.status = 'done';
    run.stage = 'done';
    artifactEvent(run, emit, 'roadmap', saved);
    logTo(run, 'orchestrator', `Published ${approved ? 'approved roadmap' : 'Draft — incomplete'} → ${saved.id}`, emit);
    emit({ type: 'done', run: publicRun(run), roadmap: saved });
    return run;
  } catch (e) {
    await failRun(run, emit, e);
    throw e;
  } finally {
    activeGenerations.delete(run.id);
    methodologyCache.delete(run.id);
  }
}
```

- Rewrite `runPipeline(input, emit, deps = {})`:

```js
async function runPipeline(input, emit, deps = {}) {
  const d = resolveDeps(deps);
  const settings = store.loadSettings();
  const run = newRun(input);
  run.stage = 'research';
  store.saveRun(run);
  emit({ type: 'run', run: publicRun(run) });

  try {
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      throw new Error('Configure your AI settings first (Base URL, API key, Model)');
    }
    logTo(run, 'orchestrator', `Pipeline started for: "${input}"`, emit);
    agentEvent(run, emit, 'researcher', 'working', 'Reading the source');
    run.artifacts.research = await d.research(settings, input, (msg) => logTo(run, 'researcher', msg, emit));
    artifactEvent(run, emit, 'research', run.artifacts.research);
    agentEvent(run, emit, 'researcher', 'done', 'Research complete');
    run.answers = [];
    run.playback = { summary: 'One-shot generation', bullets: [], openQuestions: [] };
    run.chosenApproach = { id: 'auto', title: 'Automatic' };
    store.saveRun(run);
  } catch (e) {
    await failRun(run, emit, e);
    throw e;
  }

  return runGeneration(run, emit, d);
}
```

- Keep `normalizePhases` but:
  - remove the `.slice(0, 6)` cap on `skills`, the `.slice(0, 4)` cap on `checklist`, and the `.slice(0, 4)` cap on `resources`;
  - remove `.filter((p) => p.steps.length > 0)` so an empty phase survives into validation and gets repaired instead of silently disappearing;
  - add `covers: (Array.isArray(p.covers) ? p.covers : []).map(String)` to each phase and `covers` / `addressesPitfalls` mapped the same way to each step;
  - keep `miniProject` and `checklist`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/agents.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/agents.js test/agents.test.js
git commit -m "feat: staged generation with validation, repair and draft publish"
```

---

### Task 8: Brainstorm session stages and resume

**Files:**
- Modify: `lib/agents.js`
- Modify: `test/agents.test.js`

**Interfaces:**
- Consumes: `interview`, `store`, `skills`.
- Produces:
  - `startBrainstorm(input, deps?) -> Promise<{ run, question }>`
  - `answerQuestion(runId, answer, deps?) -> Promise<{ run, question?, playback?, approaches? }>`
  - `confirmPlayback(runId, action, edits, deps?) -> Promise<{ run, playback?, approaches? }>`
  - `chooseApproach(runId, approachId, deps?) -> Promise<{ run }>`

- [ ] **Step 1: Write the failing tests**

Append to `test/agents.test.js`:

```js
function interviewStubs(overrides = {}) {
  return {
    nextQuestion: async () => ({ done: false, question: 'What is your level?' }),
    playback: async () => ({ summary: 'You want Rust', bullets: ['b'], openQuestions: [] }),
    approaches: async () => ({ approaches: [{ id: 'a', title: 'A', description: 'd', tradeoffs: 't' }], recommendedId: 'a' }),
    ...overrides,
  };
}

test('startBrainstorm creates a run, researches, and stores the first question', async () => {
  const deps = stubs({ interview: interviewStubs() });
  const { run, question } = await agents.startBrainstorm('rust', deps);
  assert.equal(run.stage, 'questions');
  assert.equal(question, 'What is your level?');
  assert.equal(store.getRun(run.id).pendingQuestion, 'What is your level?');
});

test('answerQuestion moves to playback after the model says done', async () => {
  const deps = stubs({ interview: interviewStubs({ nextQuestion: async () => ({ done: true }), playback: async () => ({ summary: 'S', bullets: ['b'], openQuestions: [] }) }) });
  const { run } = await agents.startBrainstorm('rust', deps);
  const out = await agents.answerQuestion(run.id, 'beginner', deps);
  assert.equal(out.run.stage, 'playback');
  assert.equal(out.run.playback.summary, 'S');
  assert.equal(out.run.answers.length, 1);
});

test('confirmPlayback then chooseApproach reaches ready state', async () => {
  const deps = stubs({ interview: interviewStubs({
    nextQuestion: async () => ({ done: true }),
    playback: async () => ({ summary: 'S', bullets: [], openQuestions: [] }),
    approaches: async () => ({ approaches: [{ id: 'a', title: 'A', description: 'd', tradeoffs: 't' }], recommendedId: 'a' }),
  }) });
  const { run } = await agents.startBrainstorm('rust', deps);
  await agents.answerQuestion(run.id, 'beginner', deps);
  const confirmed = await agents.confirmPlayback(run.id, 'approve', null, deps);
  assert.equal(confirmed.run.stage, 'approaches');
  assert.equal(confirmed.run.approaches.length, 1);
  const chosen = await agents.chooseApproach(run.id, 'auto', deps);
  assert.equal(chosen.run.stage, 'ready');
  assert.equal(chosen.run.chosenApproach.id, 'a');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/agents.test.js`
Expected: FAIL — `startBrainstorm` is not a function.

- [ ] **Step 3: Implement the brainstorm stages in `lib/agents.js`**

```js
async function startBrainstorm(input, deps = {}) {
  const d = resolveDeps(deps);
  const settings = store.loadSettings();
  if (!settings.apiKey || !settings.baseUrl || !settings.model) throw new Error('Configure your AI settings first.');
  const run = newRun(input);
  run.stage = 'research';
  store.saveRun(run);
  const methodology = await getMethodology(d, settings, run.id);
  run.methodologySource = methodology.source;
  run.methodologyChars = methodology.totalChars;
  agentEvent(run, null, 'researcher', 'working', 'Reading the source before the interview');
  logTo(run, 'researcher', 'Reading the source before the interview');
  const research = await d.research(settings, input, (msg) => logTo(run, 'researcher', msg));
  run.artifacts.research = research;
  agentEvent(run, null, 'researcher', 'done', 'Research complete');
  agentEvent(run, null, 'interviewer', 'working', 'Asking the first question');
  const ctx = { input, research, answers: [], methodology };
  const q = await d.interview.nextQuestion(settings, ctx);
  if (q.done) {
    run.stage = 'playback';
    run.playback = await d.interview.playback(settings, ctx);
    run.pendingQuestion = null;
  } else {
    run.stage = 'questions';
    run.pendingQuestion = q.question;
  }
  run.questionIndex = run.answers.length;
  run.artifacts.interview = { answers: run.answers, playback: run.playback, approaches: run.approaches, chosenApproach: run.chosenApproach };
  store.saveRun(run);
  return { run, runId: run.id, stage: run.stage, question: run.pendingQuestion, index: run.answers.length };
}
```

`agentEvent`, `logTo`, `artifactEvent` and `getMethodology` already exist from Task 7; the interview stages reuse them, passing `null` for `emit` because these routes reply with JSON rather than SSE.

Implement the remaining helpers with the same store-save discipline. `answerQuestion`:

```js
async function answerQuestion(runId, answer, deps = {}) {
  const d = resolveDeps(deps);
  const settings = store.loadSettings();
  const run = store.getRun(runId);
  if (!run) throw new Error('Run not found');
  if (run.stage !== 'questions' || !run.pendingQuestion) throw new Error('This run is not waiting for an answer');
  run.answers.push({ q: run.pendingQuestion, a: String(answer || '').slice(0, 2000), ts: Date.now() });
  run.questionIndex = run.answers.length;
  const methodology = await getMethodology(d, settings, run.id);
  const ctx = { input: run.input, research: run.artifacts.research, answers: run.answers, methodology };
  const next = await d.interview.nextQuestion(settings, ctx);
  if (next.done) {
    run.stage = 'playback';
    run.playback = await d.interview.playback(settings, ctx);
    run.pendingQuestion = null;
    agentEvent(run, null, 'interviewer', 'done', 'Playback ready for confirmation');
  } else {
    run.pendingQuestion = next.question;
  }
  run.artifacts.interview = { answers: run.answers, playback: run.playback, approaches: run.approaches, chosenApproach: run.chosenApproach };
  store.saveRun(run);
  return { run, stage: run.stage, question: run.pendingQuestion, playback: run.playback, index: run.answers.length };
}
```

`confirmPlayback`:
- Load the run, rebuild `ctx` exactly as in `answerQuestion`, and call `getMethodology`.
- `action === 'edit'`: append `{ q: 'Correction', a: edits }` to answers, save, regenerate playback, stay in `playback`, return `{ run, playback }`.
- `action === 'approve'`: `const out = await d.interview.approaches(settings, ctx); run.approaches = out.approaches; run.recommendedApproachId = out.recommendedId; run.stage = 'approaches';` save; `run.artifacts.interview = { ... }`; return `{ run, approaches: run.approaches }`.
- Any other action throws `Unknown action`.

`chooseApproach`:
- Load the run; require `run.stage === 'approaches'`.
- `const id = approachId === 'auto' ? run.recommendedApproachId : approachId;`
- Find the picked approach by id; throw `Unknown approach` if absent.
- `run.chosenApproach = picked; run.stage = 'ready';` save; update `run.artifacts.interview`; return `{ run }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/agents.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agents.js test/agents.test.js
git commit -m "feat: resumable brainstorm stages"
```

---

### Task 9: Server routes and testable server factory

**Files:**
- Modify: `server.js`
- Create: `test/server.test.js`

**Interfaces:**
- Consumes: `lib/agents`.
- Produces:
  - `createServer(deps?) -> http.Server` (does not listen).
  - Routes from the spec.
  - `server.listen` only when `require.main === module`.

- [ ] **Step 1: Write the failing test**

Create `test/server.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../server');

function fakeAgents() {
  const calls = [];
  return {
    calls,
    startBrainstorm: async (input) => { calls.push(['start', input]); return { run: { id: 'run_1', input, stage: 'questions' }, question: 'What is your level?' }; },
    answerQuestion: async (id, answer) => { calls.push(['answer', id, answer]); return { run: { id, stage: 'playback' }, playback: { summary: 'S' } }; },
    confirmPlayback: async (id, action) => { calls.push(['confirm', id, action]); return { run: { id, stage: 'approaches' }, approaches: [] }; },
    chooseApproach: async (id, approachId) => { calls.push(['approach', id, approachId]); return { run: { id, stage: 'ready' } }; },
    runGeneration: async (id, emit) => { emit({ type: 'done', run: { id } }); return { id }; },
    runPipeline: async (input, emit) => { emit({ type: 'done', run: { id: 'run_2' } }); return { id: 'run_2' }; },
  };
}

async function withServer(fn) {
  const deps = { agents: fakeAgents() };
  const server = createServer(deps);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try { await fn(`http://127.0.0.1:${port}`, deps); }
  finally { await new Promise((r) => server.close(r)); }
}

test('start -> answer -> confirm -> approach routes call the orchestrator', async () => {
  await withServer(async (base, deps) => {
    let res = await fetch(base + '/api/brainstorm/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'rust' }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).question, 'What is your level?');
    res = await fetch(base + '/api/runs/run_1/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: 'beginner' }) });
    assert.equal((await res.json()).run.stage, 'playback');
    res = await fetch(base + '/api/runs/run_1/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
    assert.equal((await res.json()).run.stage, 'approaches');
    res = await fetch(base + '/api/runs/run_1/approach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approachId: 'auto' }) });
    assert.equal((await res.json()).run.stage, 'ready');
    assert.equal(deps.agents.calls.length, 4);
  });
});

test('generation streams SSE events', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/api/generate/run_1', { method: 'POST' });
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const text = await res.text();
    assert.match(text, /"type":"done"/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — `createServer` is not exported.

- [ ] **Step 3: Refactor `server.js`**

- Wrap the handler in `createServer(deps = {})`:

```js
function createServer(deps = {}) {
  const resolved = { agents: deps.agents || require('./lib/agents') };
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, resolved);
      return serveStatic(res, pathname);
    } catch (e) {
      sendJson(res, 500, { error: e.message || 'Server error' });
    }
  });
}
```

- Change `handleApi(req, res, pathname, deps)` and use `deps.agents` (it already loads `store` etc. from module scope).
- Add routes before the 404:
  - `POST /api/brainstorm/start` → `deps.agents.startBrainstorm(input)`; 400 if `input` is empty.
  - `POST /api/runs/:id/answer` → `deps.agents.answerQuestion(id, answer)`.
  - `POST /api/runs/:id/confirm` → `deps.agents.confirmPlayback(id, action, edits)`.
  - `POST /api/runs/:id/approach` → `deps.agents.chooseApproach(id, approachId)`.
  - `POST /api/generate/:runId` (SSE) → `deps.agents.runGeneration(runId, send)`. Put this check before the exact `/api/generate` check.
- `POST /api/generate` keeps the one-shot `deps.agents.runPipeline(input, send)`.
- Add a shared `startSse(req, res)` helper with the existing headers and `send`; reuse it in both SSE routes instead of duplicating.
- At the bottom:

```js
if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => console.log(`RoadmapForge running → http://127.0.0.1:${PORT}`));
}
module.exports = { createServer };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/server.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server.js test/server.test.js
git commit -m "feat: brainstorm and generation API routes"
```

---

### Task 10: Frontend interview flow

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: routes from Task 9, run `stage` values.
- Produces: route `#/interview/:id`, chat cards, playback, approach cards, generation handoff.

- [ ] **Step 1: Add the interview view markup**

In `public/index.html`, add after `view-home`:

```html
<section id="view-interview" class="view hidden">
  <div class="interview-shell">
    <a href="#/" class="back-link">← Back</a>
    <div class="interview-head">
      <div class="hero-badge"><span class="pulse-dot"></span> Superpowers brainstorm</div>
      <h1 class="interview-title">Before the roadmap, a few questions</h1>
      <p class="interview-sub" id="interviewSub"></p>
      <div class="q-progress" id="qProgress"></div>
    </div>
    <div class="chat" id="chat"></div>
    <form class="answer-bar" id="answerForm" autocomplete="off">
      <textarea id="answerInput" rows="2" placeholder="Type your answer…"></textarea>
      <div class="answer-actions">
        <button class="btn btn-ghost btn-sm" id="btnSkip" type="button">Skip</button>
        <button class="btn btn-ghost btn-sm" id="btnDecide" type="button">You decide</button>
        <button class="btn btn-primary" id="btnAnswer" type="submit">Send</button>
      </div>
    </form>
  </div>
</section>
```

- [ ] **Step 2: Add styles**

Append to `public/style.css`:

```css
/* ---------- interview ---------- */
.interview-shell { max-width: 760px; margin: 0 auto; padding: 32px 20px 80px; }
.interview-head { margin: 20px 0 24px; }
.interview-title { font-size: clamp(28px, 4vw, 40px); margin: 12px 0 8px; }
.interview-sub { color: var(--text-dim); }
.q-progress { display: flex; gap: 6px; margin-top: 14px; }
.q-dot { width: 26px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.12); }
.q-dot.on { background: var(--accent); }
.chat { display: flex; flex-direction: column; gap: 14px; }
.bubble { max-width: 86%; padding: 12px 16px; border-radius: 16px; line-height: 1.5; background: rgba(255,255,255,.05); border: 1px solid var(--border); }
.bubble.ai { align-self: flex-start; border-bottom-left-radius: 4px; }
.bubble.user { align-self: flex-end; background: rgba(124,92,255,.16); border-color: rgba(124,92,255,.35); border-bottom-right-radius: 4px; }
.bubble .b-who { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-faint); margin-bottom: 4px; }
.answer-bar { position: sticky; bottom: 16px; margin-top: 20px; padding: 12px; border: 1px solid var(--border); border-radius: 16px; background: rgba(10,12,20,.92); backdrop-filter: blur(10px); }
.answer-bar textarea { width: 100%; resize: vertical; border: 0; background: transparent; color: var(--text); font: inherit; outline: none; }
.answer-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.approach-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.approach { text-align: left; padding: 16px; border-radius: 14px; border: 1px solid var(--border); background: rgba(255,255,255,.03); color: var(--text); cursor: pointer; }
.approach.sel { border-color: var(--accent); background: rgba(124,92,255,.12); }
.approach b { display: block; margin-bottom: 6px; }
.approach small { color: var(--text-dim); display: block; margin-top: 8px; }
```

- [ ] **Step 3: Implement the flow in `public/app.js`**

- Add `const viewInterview = $('#view-interview');` and `let currentRun = null;` in the state section.
- Add a `showView(el)` helper that hides `viewHome`, `viewRoadmap`, and `viewInterview` except `el`. Use it in `route`, `showRoadmap`, and `showInterview` so the three views never stack.
- Move the existing `<div class="agentbay hidden" id="agentbay">…</div>` block out of `#view-home` and place it once, directly inside `<main id="app">` after the three view sections, so generation progress is visible on both the home and interview views.
- Extend `route()`:

```js
let m = hash.match(/^#\/interview\/([A-Za-z0-9_-]+)$/);
if (m) return showInterview(m[1]);
```

- Change the form submit handler to call `startBrainstorm(input)` instead of `generate(input)`:

```js
async function startBrainstorm(input) {
  if (generating) return;
  generating = true;
  genBtn.disabled = true;
  genBtn.textContent = 'Researching…';
  try {
    const res = await api('/api/brainstorm/start', { method: 'POST', body: { input } });
    location.hash = `#/interview/${res.runId || res.run.id}`;
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    generating = false;
    genBtn.disabled = false;
    genBtn.textContent = 'Forge roadmap';
  }
}
```

- Rename the existing SSE function `generate(input)` to `streamGeneration(runId)`: keep the reader loop and `handleEvent`, but fetch `/api/generate/${runId}` with `POST` and no body. It sets `generating = true`, shows the agent bay, resets the cards, and streams events as today.
- `showInterview(id)`: fetch `/api/runs/:id`; set `currentRun = run`; `showView(viewInterview)`; render the header, progress dots, and transcript; branch on `stage`:
  - `questions`: show the pending question bubble and the answer bar.
  - `playback`: render the summary + "Looks right" / "Change something" buttons.
  - `approaches`: render approach cards + Continue.
  - `ready`: show a "Start generation" card. Clicking it calls `streamGeneration(id)`.
  - `generating`: do **not** start a second SSE stream after a refresh. Show "Agents are working…" and poll `GET /api/runs/:id` every 2 seconds; when `stage` becomes `done`, navigate to `#/run/:id`. After 20 polls, show a "Retry generation" button that calls `streamGeneration(id)` (the server rejects a real duplicate with "Generation already running").
  - `done`: redirect to `#/run/${id}`.
  - `failed`: show `run.error` and a "Retry generation" button that calls `streamGeneration(id)`.
- `submitAnswer(text)`: POST `/api/runs/:id/answer`; set `currentRun` from `response.run` and re-render.
- `confirmPlayback(action, edits)`: POST `/api/runs/:id/confirm`; set `currentRun` and re-render.
- `chooseApproach(id)`: POST `/api/runs/:id/approach`; set `currentRun`, then `streamGeneration(runId)`.
- Render the Q/A transcript from `run.answers` (`{q, a}`) plus `run.pendingQuestion`; render `run.playback` and `run.approaches`.
- Keep skip/decide buttons sending `"Skip"` / `"You decide"`.
- Disable the answer bar while a request is in flight.
- `handleEvent` should treat `evt.type === 'stage'` by updating `bayTitle` / the interview status line, and on `done` keep the existing `#/run/:id` navigation. `handleEvent` must also tolerate a missing `#activityList` (guard `addLog`), because SSE can stream while the home view is hidden.

- [ ] **Step 4: Verify manually**

Stop the already-running server on port 8787 first (existing PID 16668), then run: `npm start`
Expected: server starts.

In a browser at `http://127.0.0.1:8787`:
1. Submit a topic → interview view opens with question 1.
2. Answer twice; transcript shows Q/A bubbles.
3. Refresh mid-interview → same pending question returns, prior answers still shown.
4. Finish questions → playback card appears; approve.
5. Approach cards appear; pick one → generation starts.

Expected: each step advances without console errors.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: interview UI with resume and generation handoff"
```

---

### Task 11: Agent drawer with per-agent tabs

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `GET /api/runs/:id`, SSE `artifact` events.
- Produces: `<aside id="agentDrawer">` with tabs Orchestrator / Researcher / Interviewer / Planner / Reviewer; open/close; live refresh.

- [ ] **Step 1: Add drawer markup**

Add after `</main>` (before the settings modal):

```html
<aside class="drawer hidden" id="agentDrawer" aria-label="Agent responses">
  <div class="drawer-head">
    <b>Agent responses</b>
    <button class="icon-btn" id="drawerClose" type="button" aria-label="Close">✕</button>
  </div>
  <div class="drawer-tabs" id="drawerTabs">
    <button class="dtab active" data-tab="orchestrator" type="button">Orchestrator</button>
    <button class="dtab" data-tab="researcher" type="button">Researcher</button>
    <button class="dtab" data-tab="interviewer" type="button">Interviewer</button>
    <button class="dtab" data-tab="planner" type="button">Planner</button>
    <button class="dtab" data-tab="reviewer" type="button">Reviewer</button>
  </div>
  <div class="drawer-body" id="drawerBody"></div>
</aside>
```

Add exactly one trigger button in the top navigation, next to Settings:

```html
<button class="btn btn-ghost btn-sm hidden" id="btnDrawer" type="button">Agents</button>
```

- [ ] **Step 2: Add drawer styles**

```css
/* ---------- agent drawer ---------- */
.drawer { position: fixed; top: 0; right: 0; height: 100vh; width: min(520px, 96vw); z-index: 60;
  display: flex; flex-direction: column; background: rgba(10,12,20,.98); border-left: 1px solid var(--border);
  box-shadow: -20px 0 60px rgba(0,0,0,.45); transform: translateX(0); transition: transform .2s ease; }
.drawer.hidden { transform: translateX(102%); pointer-events: none; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.drawer-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.dtab { white-space: nowrap; padding: 7px 10px; border-radius: 8px; border: 0; background: transparent; color: var(--text-dim); cursor: pointer; font: inherit; }
.dtab.active { color: var(--text); background: rgba(124,92,255,.16); }
.drawer-body { overflow: auto; padding: 14px 16px 40px; }
.drawer-section { margin-bottom: 18px; }
.drawer-section h4 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-faint); }
.drawer-pre { white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, monospace; background: rgba(0,0,0,.35); padding: 10px; border-radius: 8px; }
.drawer-json { max-height: 320px; overflow: auto; }
@media (max-width: 720px) { .drawer { width: 100vw; } }
```

- [ ] **Step 3: Implement drawer rendering in `public/app.js`**

- State: `let drawerTab = 'orchestrator';` (`currentRun` already exists from Task 10) plus `const drawer = $('#agentDrawer'); const btnDrawer = $('#btnDrawer');`
- `openDrawer(run)`: set `currentRun`, remove `.hidden`, render.
- `renderDrawer(run)`:
  - Orchestrator: `run.orchestratorLog` + status + rounds/repairs/validation.
  - Researcher: `run.artifacts.research` sections + sources + raw toggle.
  - Interviewer: `run.answers` transcript + `run.pendingQuestion` + `run.playback` + `run.approaches` + chosen.
  - Planner: `run.artifacts.outline` + `run.artifacts.roadmapDraft` + `run.artifacts.roadmap` + raw.
  - Reviewer: `run.artifacts.review` (checklist, issues, score, validation) + raw.
  - Each tab includes a `<details>` "Raw JSON" with `<pre class="drawer-pre drawer-json">`.
- `bindDrawerTabs()`: switch `drawerTab`, re-render.
- `bindDrawer()` (called once at boot): `btnDrawer` opens the drawer with `currentRun`; `drawerClose` adds `.hidden`; clicking a tab switches.
- `showRun(id)` and `showInterview(id)`: after fetching `run`, set `currentRun = run`, show `btnDrawer` (remove `.hidden`), and re-render the drawer only if it is already open. Hide `btnDrawer` (and close the drawer) on the home and saved-roadmap views, where no run is loaded.
- `streamGeneration(runId)`: call `openDrawer(currentRun)` so the user watches the agents live.
- `handleEvent`: on `{type:'artifact', runId}` → `api('/api/runs/'+runId).then((run)=>{ currentRun=run; if (!drawer.classList.contains('hidden')) renderDrawer(run); }).catch(() => {})`.
- Fix timing: the server now sets `startedAt`/`endedAt`; the existing duration tag works.
- In `runDashboardHtml`, stop hardcoding three agents: number each agent by its index in `Object.entries(ag)` (`#01`, `#02`, …) and render the agent count as `Object.keys(ag).length`. Update `artifactsHtml` to also show the interview answers/playback when `r.interview` exists.

- [ ] **Step 4: Verify manually**

Run: `npm start`, open the existing run `#/run/run_mwnayft2_fc5eo5` (or a new one).
Expected:
1. "Agents" button opens the drawer.
2. Each tab shows its section; no console errors.
3. Raw JSON expands and copies.
4. During a new generation, artifacts appear in the drawer as they are produced.
5. On a narrow window, the drawer is full width.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: tabbed agent response drawer"
```

---

### Task 12: Settings UI, README, and end-to-end verification

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css` (`tag-draft`)
- Modify: `server.js` (`/api/systems/status` shape, require `lib/skills`)
- Modify: `README.md`

**Interfaces:**
- Consumes: `store.loadSettings`, `skills.loadMethodology`.
- Produces: settings fields `methodologySource`, `superpowersPath`, `callCharBudget`; status line with resolved source, path, and skill char counts.

- [ ] **Step 1: Add settings fields**

In the settings modal, replace the `Use Superpowers MCP methodology` toggle block with:

```html
<label class="field">
  <span>Methodology source</span>
  <select id="setMethodology">
    <option value="auto">Auto — local skills, then MCP</option>
    <option value="local">Local skills only</option>
    <option value="mcp">MCP only</option>
    <option value="off">Off</option>
  </select>
</label>
<label class="field">
  <span>Superpowers skills folder</span>
  <input id="setSuperpowersPath" type="text" placeholder="C:\Users\you\.config\opencode\skills" spellcheck="false">
  <small class="field-hint">Leave empty to auto-detect. Env SUPERPOWERS_PATH overrides.</small>
</label>
<label class="field">
  <span>Prompt budget per call (characters)</span>
  <input id="setBudget" type="number" min="4000" step="1000" value="24000">
  <small class="field-hint">Larger budgets need a model with a higher TPM limit.</small>
</label>
```

Keep the "Test MCP" button and the MCP URL field. The `/api/settings` API keeps accepting `useMcp` for old clients; the UI no longer sends it.

- [ ] **Step 2: Wire the fields**

- `openSettings()`: set values from `/api/settings` (`methodologySource`, `superpowersPath`, `callCharBudget`).
- `settingsSave`: include all three fields.
- `/api/settings` GET/POST responses include all three fields (masked secrets unchanged).
- `btnMcpTest` save payload uses `methodologySource` instead of `useMcp`, then fetches `/api/systems/status`.
- Draft + coverage badge:
  - In `cardHtml` and `roadmapHtml`, when `rm.review?.validation` exists, render a `<span class="tag tag-draft">Draft — incomplete</span>` if `!rm.review.validation.valid`.
  - Also render `Coverage: concepts C/T · pitfalls C/T` from `rm.review.validation.coverage` when present.
  - Add `.tag-draft { color: var(--warn); border-color: rgba(245, 158, 11, .4); background: rgba(245, 158, 11, .08); }` to `public/style.css`.
  - Old roadmaps without `review.validation` render exactly as before.

- [ ] **Step 3: Extend status**

Add `const skills = require('./lib/skills');` to the top of `server.js`. `/api/systems/status` computes `const methodology = await skills.loadMethodology(s);` and returns:

```js
methodology: {
  ok: methodology.ok,
  source: methodology.source,     // auto-resolved: local | mcp | off
  path: methodology.path || null,
  totalChars: methodology.totalChars,
  skills: skills.skillChars(methodology.skills),
  error: methodology.error || null,
}
```

The settings status box shows:
- `✅ Local skills — 27,129 chars (brainstorming 13,602 · writing-plans 10,335 · using-superpowers 3,192)` or
- `⚠️ Local skills not found — MCP: <serverName>` or
- `⚠️ Methodology off`. The line is built from the returned `source`, `path`, `totalChars`, and `skills` counts; it never claims a source that was not resolved.

- [ ] **Step 4: Update `README.md`**

Document:
- the interview → playback → approach → plan flow,
- `methodologySource`, `superpowersPath`, `SUPERPOWERS_PATH`, and `callCharBudget`,
- no fixed caps and the outline/expand strategy,
- the agent drawer,
- `npm test`.

- [ ] **Step 5: Run the full verification**

Run:
```bash
npm test
npm start
```
Expected: all tests pass; server starts.

Manual end-to-end:
1. Open the app, configure a provider, set methodology source `auto`; click "Test MCP" → status shows local or MCP with char counts.
2. Generate a roadmap for `https://doc.rust-lang.org/book/`.
3. Answer the questions, approve playback, pick an approach.
4. Watch the drawer update: Researcher → Interviewer → Planner outline → per-phase expansion → Reviewer.
5. Open the final roadmap: every step has detail, hours, verify; every phase has miniProject and checklist; the coverage line shows every concept and pitfall covered; a forced repair failure shows the "Draft — incomplete" tag.
6. Refresh mid-interview in a separate run → the same question resumes.
7. Refresh while a run is `generating` → the page polls and lands on `#/run/:id`; it does not start a duplicate generation.
8. Delete the generated roadmap and run; confirm the library and drawer still render old runs.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/style.css server.js README.md
git commit -m "feat: methodology settings, status and docs"
```

---

## Self-Review Notes

- Every spec section maps to a task: full skills (Task 1), coverage and detail validation (Task 2), no-cap sizing via outline/expand (Tasks 3 and 7), chunked review (Task 4), interview and approaches (Task 5), resume and settings (Tasks 6 and 8), API (Task 9), drawer and interview UI (Tasks 10 and 11), docs and verification (Task 12).
- Type names are consistent across tasks: `skills`, `validate`, `planner`, `reviewer`, `interview`, `runGeneration`, `startBrainstorm`, `answerQuestion`, `confirmPlayback`, `chooseApproach`.
- The five Review Focus items each have an owning test or manual check: provider limits (Task 12 manual + Task 7 error path), interview refresh (Task 10 manual + Task 8 tests), coverage repair/draft (Tasks 2 and 7), missing skills path (Task 1), old files (Task 12 manual).

Concrete mismatches found during self-review and fixed inline:
- Orchestrator helper signatures (`agentEvent`/`logTo`/`artifactEvent`/`getMethodology`/`failRun`) were only referenced; they are now defined once in Task 7 and reused by Tasks 8/9/11. `emit` is optional so JSON interview routes can call them with `null`.
- `REVIEW_SCHEMA` issues had no phase id; added `phaseId`, plus `phasesForErrors` (validation paths) and `reviewErrorsForPhase` (review issues), so repairs target the right phase instead of the whole roadmap.
- Publish state was incomplete: `run.rounds`, `review.validation`, `reviewerApproved`, `stage='failed'`, `run.error`, an `activeGenerations` guard and a per-run methodology cache are now explicit; the draft test asserts `repairs === 2` and `approved === false`.
- `normalizePhases` no longer drops empty phases or truncates skills/checklist/resources/covers — validation, not silent trimming, owns correctness.
- `loadMethodology('auto')` reports a resolved-but-broken local install instead of silently falling back to MCP (new test, 7 skills tests).
- `MAX_QUESTIONS` raised to 12 with the model deciding `done` — no arbitrary 6-question cap.
- Interview stage helpers now return `runId`/`stage`/`index`, keep `artifacts.interview` in sync, and validate run state on transitions.
- Frontend: `currentRun` declared once, single `showView` helper, no premature `openDrawer` calls, agent bay moved out of `#view-home`, `generating` refresh polls instead of starting a second SSE stream, drawer numbering is dynamic, and old saved views hide the drawer button.
- Task 12 wires `require('./lib/skills')`, all three settings fields, the `Draft — incomplete` + coverage badge, and `summaryOf.review` for library cards; test counts were corrected to match the actual test bodies.

Every task keeps its own failing-test → implement → passing-test → commit loop; the plan is intentionally detailed because the existing single-shot pipeline must be replaced without regressions.
