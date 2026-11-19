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
