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
