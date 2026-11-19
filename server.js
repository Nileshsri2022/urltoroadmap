// RoadmapForge — paste any link or topic, get a complete saved roadmap.
// Backend: zero-dependency Node.js. AI: any OpenAI-compatible endpoint.
// Methodology: Superpowers MCP skill server (brainstorming + writing-plans).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const store = require('./lib/store');
const mcp = require('./lib/mcp');
const llm = require('./lib/llm');
const extract = require('./lib/extract');
const composio = require('./lib/composio');

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

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

// ---------------------------------------------------------------- API

async function handleApi(req, res, pathname, deps) {
  let m;
  if (pathname === '/api/settings' && req.method === 'GET') {
    const s = store.loadSettings();
    return sendJson(res, 200, {
      baseUrl: s.baseUrl, model: s.model, useMcp: s.useMcp, mcpUrl: s.mcpUrl,
      composioUrl: s.composioUrl, hasComposioKey: Boolean(s.composioToken),
      hasKey: Boolean(s.apiKey),
      apiKeyPreview: maskKey(s.apiKey),
      composioKeyPreview: maskKey(s.composioToken),
    });
  }
  if (pathname === '/api/settings' && req.method === 'POST') {
    const body = await readJson(req);
    const s = store.saveSettings(body || {});
    return sendJson(res, 200, {
      baseUrl: s.baseUrl, model: s.model, useMcp: s.useMcp, mcpUrl: s.mcpUrl,
      composioUrl: s.composioUrl, hasComposioKey: Boolean(s.composioToken),
      hasKey: Boolean(s.apiKey),
      apiKeyPreview: maskKey(s.apiKey),
      composioKeyPreview: maskKey(s.composioToken),
    });
  }

  if (pathname === '/api/mcp/status' && req.method === 'GET') {
    try {
      const s = store.loadSettings();
      const info = await mcp.status(s.mcpUrl);
      return sendJson(res, 200, { ok: true, serverName: info.serverName, toolCount: info.tools.length });
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/systems/status' && req.method === 'GET') {
    const s = store.loadSettings();
    const [superpowers, composioSt] = await Promise.allSettled([
      mcp.status(s.mcpUrl),
      composio.status(s.composioUrl, s.composioToken),
    ]);
    return sendJson(res, 200, {
      ai: { ok: Boolean(s.apiKey && s.baseUrl && s.model), model: s.model, hasKey: Boolean(s.apiKey) },
      superpowers: superpowers.status === 'fulfilled'
        ? { ok: true, serverName: superpowers.value.serverName, toolCount: superpowers.value.tools.length }
        : { ok: false, error: superpowers.reason?.message || 'failed' },
      composio: s.composioToken
        ? (composioSt.status === 'fulfilled' ? composioSt.value : { ok: false, error: composioSt.reason?.message || 'failed' })
        : { ok: false, error: 'No Composio token configured — Researcher will use native fetch' },
    });
  }

  if (pathname === '/api/roadmaps' && req.method === 'GET') {
    return sendJson(res, 200, { roadmaps: store.listRoadmaps() });
  }

  m = pathname.match(/^\/api\/roadmaps\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (req.method === 'GET') {
      const rm = store.getRoadmap(id);
      return rm ? sendJson(res, 200, rm) : sendJson(res, 404, { error: 'Roadmap not found' });
    }
    if (req.method === 'DELETE') {
      const ok = store.deleteRoadmap(id);
      return sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Roadmap not found' });
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const rm = store.updateProgress(id, (body || {}).progress || {});
      return rm ? sendJson(res, 200, rm) : sendJson(res, 404, { error: 'Roadmap not found' });
    }
  }

  if (pathname === '/api/brainstorm/start' && req.method === 'POST') {
    const body = await readJson(req);
    const input = String((body || {}).input || '').trim();
    if (!input) return sendJson(res, 400, { error: 'Give me a link or a topic first.' });
    return sendJson(res, 200, await deps.agents.startBrainstorm(input));
  }

  m = pathname.match(/^\/api\/runs\/([^/]+)\/answer$/);
  if (m && req.method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, await deps.agents.answerQuestion(m[1], (body || {}).answer));
  }

  m = pathname.match(/^\/api\/runs\/([^/]+)\/confirm$/);
  if (m && req.method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, await deps.agents.confirmPlayback(m[1], (body || {}).action, (body || {}).edits));
  }

  m = pathname.match(/^\/api\/runs\/([^/]+)\/approach$/);
  if (m && req.method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, await deps.agents.chooseApproach(m[1], (body || {}).approachId));
  }

  // Keep the single-run SSE route ahead of the exact /api/generate one-shot check.
  m = pathname.match(/^\/api\/generate\/([^/]+)$/);
  if (m && req.method === 'POST') {
    return generateRun(req, res, m[1], deps.agents);
  }

  if (pathname === '/api/generate' && req.method === 'POST') {
    const body = await readJson(req);
    return generate(req, res, String((body || {}).input || '').trim(), deps.agents);
  }

  m = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (m && req.method === 'GET') {
    const run = store.getRun(m[1]);
    return run ? sendJson(res, 200, run) : sendJson(res, 404, { error: 'Run not found' });
  }

  if (pathname === '/api/demo' && req.method === 'POST') {
    const rm = demoRoadmap();
    store.saveRoadmap(rm);
    return sendJson(res, 200, rm);
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

// ---------------------------------------------------------------- pipeline (3 agents + orchestrator)

// Shared SSE setup for both generation routes. Always returns a real send
// function: failRun() emits an error event with no guard, so generation must
// never be handed a null writer.
function startSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (evt) => { try { res.write('data: ' + JSON.stringify(evt) + '\n\n'); } catch {} };
  req.on('close', () => { res.destroy(); });
  return send;
}

async function generateRun(req, res, runId, agents) {
  const send = startSse(req, res);
  try {
    await agents.runGeneration(runId, send);
  } catch {
    // error event already emitted inside the generation
  }
  res.end();
}

async function generate(req, res, input, agents) {
  if (!input) return sendJson(res, 400, { error: 'Give me a link or a topic first.' });

  const settings = store.loadSettings();
  if (!settings.apiKey || !settings.baseUrl || !settings.model) {
    return sendJson(res, 400, { error: 'Configure your AI settings first (Base URL, API key, Model).' });
  }

  const send = startSse(req, res);
  try {
    await agents.runPipeline(input, send);
  } catch {
    // error event already emitted inside the pipeline
  }
  res.end();
}

// ---------------------------------------------------------------- helpers

// Show just enough of a secret to identify it — never the whole value.
function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  return s.length <= 10 ? s[0] + '…' : s.slice(0, 6) + '…' + s.slice(-3);
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA-ish fallback for unknown non-asset paths.
      if (!path.extname(rel)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) return sendJson(res, 404, { error: 'Not found' });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        });
      }
      return sendJson(res, 404, { error: 'Not found' });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

function demoRoadmap() {
  return {
    id: store.newId(),
    title: 'Mastering Rust: Systems Programming Roadmap',
    emoji: '🦀',
    summary: 'A hands-on path from zero Rust to shipping a fast, safe CLI tool and a small web service. Built from the official book, Rustlings exercises, and real projects.',
    difficulty: 'beginner',
    estimatedDuration: '10-12 weeks at 6-8h/week',
    principles: [
      'Fight the borrow checker on purpose — every compiler error is a lesson, not a setback.',
      'Read one chapter, then immediately write code that breaks it.',
      'Prefer small crates you finish over big projects you abandon.',
      'cargo clippy is your reviewer; run it before every commit.',
    ],
    milestoneProject: 'Ship a multi-threaded CLI that reads a directory of logs, aggregates statistics with rayon, and prints a colored report — tested with cargo test and packaged with cargo install.',
    phases: [
      {
        id: 'p1', title: 'Ownership & Foundations', goal: 'You can explain ownership, borrowing and lifetimes out loud.', duration: 'Week 1-3',
        skills: ['Ownership', 'Borrowing', 'Slices', 'Enums & pattern matching'],
        steps: [
          { id: 'p1_1', title: 'Read The Book chapters 1-6', detail: 'Work through variables, data types, functions and ownership. Type every example yourself — no copy-paste.', resources: [{ label: 'The Rust Programming Language', url: 'https://doc.rust-lang.org/book/' }] },
          { id: 'p1_2', title: 'Complete Rustlings: intro + move_semantics', detail: 'These two tracks drill exactly the intuition The Book describes. Repeat move_semantics until it feels boring.', resources: [{ label: 'Rustlings', url: 'https://github.com/rust-lang/rustlings' }] },
          { id: 'p1_3', title: 'Build a temperature converter CLI', detail: 'Parse args, convert C↔F↔K, handle bad input without panicking. Your first fight with Result.' },
        ],
      },
      {
        id: 'p2', title: 'Real Programs with Error Handling', goal: 'You can write a CLI that fails gracefully and is testable.', duration: 'Week 4-6',
        skills: ['Result & ?', 'Custom errors', 'Traits', 'Testing'],
        steps: [
          { id: 'p2_1', title: 'Read The Book chapters 7-10', detail: 'Modules, collections, error handling, generics and traits — the vocabulary of every Rust codebase.', resources: [{ label: 'The Rust Programming Language', url: 'https://doc.rust-lang.org/book/' }] },
          { id: 'p2_2', title: 'Build a grep clone (minigrep)', detail: 'The Book chapter 12 project: file I/O, env vars, iterators. Extend it with case-insensitive search.', resources: [{ label: 'Chapter 12: minigrep', url: 'https://doc.rust-lang.org/book/ch12-00-an-io-project.html' }] },
          { id: 'p2_3', title: 'Add tests and CI', detail: 'Unit tests for parsing, integration test for the binary, then a GitHub Actions workflow that runs cargo test on push.', resources: [{ label: 'Rust CI on GitHub Actions', url: 'https://github.com/actions-rs/example' }] },
        ],
      },
      {
        id: 'p3', title: 'Concurrency & Shipping', goal: 'You can use threads, channels and rayon, and ship an installable tool.', duration: 'Week 7-10',
        skills: ['Threads', 'Channels', 'rayon', 'Smart pointers'],
        steps: [
          { id: 'p3_1', title: 'Read The Book chapters 13-16 + 20', detail: 'Closures, iterators, smart pointers, fearless concurrency and async — the power-user chapters.', resources: [{ label: 'The Rust Programming Language', url: 'https://doc.rust-lang.org/book/' }] },
          { id: 'p3_2', title: 'Parallelize a word-count tool with rayon', detail: 'Take a serial wc clone, make it parallel with one iterator change. Measure the speedup.', resources: [{ label: 'rayon', url: 'https://crates.io/crates/rayon' }] },
          { id: 'p3_3', title: 'Build the milestone: log-stats CLI', detail: 'Multi-threaded log aggregator with colored output. cargo clippy clean, tested, published to crates.io if you dare.' },
        ],
      },
    ],
    source: { type: 'topic', value: 'demo: learning rust', title: 'Demo roadmap', description: '', excerpt: '' },
    model: 'demo (no AI used)',
    mcpUsed: true,
    createdAt: Date.now(),
    progress: {},
  };
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => console.log(`RoadmapForge running → http://127.0.0.1:${PORT}`));
}

module.exports = { createServer };
