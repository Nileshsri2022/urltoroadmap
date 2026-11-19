// File-backed storage for settings and roadmaps. Zero dependencies.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.ROADMAP_FORGE_DATA_DIR || path.join(__dirname, '..', 'data');
const ROADMAPS_DIR = path.join(DATA_DIR, 'roadmaps');
const RUNS_DIR = path.join(DATA_DIR, 'runs');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  useMcp: true,
  mcpUrl: 'https://mcp.skillsovermcp.com/mcp/obra/superpowers',
  composioUrl: 'https://connect.composio.dev/mcp',
  composioToken: '',
  methodologySource: 'auto',
  superpowersPath: '',
  callCharBudget: 24000,
};

const METHODOLOGY_SOURCES = ['auto', 'local', 'mcp', 'off'];

function ensureDirs() {
  fs.mkdirSync(ROADMAPS_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

function loadSettings() {
  try {
    // Parse raw first so the legacy useMcp -> methodologySource mapping can be
    // detected from the file itself, not from the post-merge defaults.
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const rawHasMethodology = Object.prototype.hasOwnProperty.call(raw, 'methodologySource');
    const merged = { ...DEFAULT_SETTINGS, ...raw };
    if (!rawHasMethodology) {
      merged.methodologySource = merged.useMcp === false ? 'off' : 'auto';
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(patch) {
  patch = patch || {};
  ensureDirs();
  const current = loadSettings();
  const next = { ...current };
  for (const key of ['baseUrl', 'model', 'useMcp', 'mcpUrl', 'composioUrl', 'superpowersPath']) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  // Invalid values are ignored so a bad patch cannot corrupt persisted settings.
  if (METHODOLOGY_SOURCES.includes(patch.methodologySource)) {
    next.methodologySource = patch.methodologySource;
  }
  if (Number.isInteger(patch.callCharBudget) && patch.callCharBudget > 0) {
    next.callCharBudget = patch.callCharBudget;
  }
  // Empty key strings mean "keep existing" so a masked GET can round-trip.
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim() !== '') {
    next.apiKey = patch.apiKey.trim();
  }
  if (typeof patch.composioToken === 'string' && patch.composioToken.trim() !== '') {
    next.composioToken = patch.composioToken.trim();
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

function roadmapPath(id) {
  if (!ID_RE.test(id)) throw new Error('Invalid roadmap id');
  return path.join(ROADMAPS_DIR, id + '.json');
}

function saveRoadmap(rm) {
  ensureDirs();
  fs.writeFileSync(roadmapPath(rm.id), JSON.stringify(rm, null, 2));
}

function getRoadmap(id) {
  try {
    return JSON.parse(fs.readFileSync(roadmapPath(id), 'utf8'));
  } catch {
    return null;
  }
}

function deleteRoadmap(id) {
  try { fs.unlinkSync(roadmapPath(id)); return true; } catch { return false; }
}

function listRoadmaps() {
  ensureDirs();
  let files = [];
  try { files = fs.readdirSync(ROADMAPS_DIR).filter((f) => f.endsWith('.json')); } catch {}
  return files
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(ROADMAPS_DIR, f), 'utf8')); } catch { return null; }
    })
    .filter(Boolean)
    .map(summaryOf)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function summaryOf(rm) {
  const phases = Array.isArray(rm.phases) ? rm.phases : [];
  let total = 0, done = 0;
  for (const p of phases) {
    for (const s of p.steps || []) {
      total++;
      if (rm.progress && rm.progress[s.id]) done++;
    }
  }
  return {
    id: rm.id,
    title: rm.title,
    emoji: rm.emoji,
    summary: rm.summary,
    difficulty: rm.difficulty,
    estimatedDuration: rm.estimatedDuration,
    source: rm.source,
    model: rm.model,
    createdAt: rm.createdAt,
    phaseCount: phases.length,
    stepTotal: total,
    stepDone: done,
    review: rm.review,
  };
}

function newId() {
  return 'rm_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function updateProgress(id, progress) {
  const rm = getRoadmap(id);
  if (!rm) return null;
  rm.progress = { ...(rm.progress || {}), ...(progress || {}) };
  // Drop false entries to keep files small.
  for (const k of Object.keys(rm.progress)) if (!rm.progress[k]) delete rm.progress[k];
  saveRoadmap(rm);
  return rm;
}

// ---------------------------------------------------------------- runs (agent pipeline)

function saveRun(run) {
  ensureDirs();
  fs.writeFileSync(path.join(RUNS_DIR, run.id + '.json'), JSON.stringify(run, null, 2));
}

function getRun(id) {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, id + '.json'), 'utf8'));
  } catch {
    return null;
  }
}

function updateRun(id, patch) {
  const run = getRun(id);
  if (!run) return null;
  const next = { ...run, ...(patch || {}) };
  saveRun(next);
  return next;
}

module.exports = {
  loadSettings, saveSettings,
  listRoadmaps, getRoadmap, saveRoadmap, deleteRoadmap, updateProgress, newId,
  saveRun, getRun, updateRun,
  SETTINGS_FILE,
};
