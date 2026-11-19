/* RoadmapForge frontend — vanilla JS, no build step.
   3-agent pipeline: Researcher → Planner → Reviewer (orchestrated), dashboard with tabs. */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const viewHome = $('#view-home');
const viewRoadmap = $('#view-roadmap');
const viewInterview = $('#view-interview');
const genForm = $('#genForm');
const genInput = $('#genInput');
const genBtn = $('#genBtn');
const agentbay = $('#agentbay');
const bayTitle = $('#bayTitle');
const cardsEl = $('#cards');
const emptyEl = $('#empty');
const libCount = $('#libCount');
const toastsEl = $('#toasts');
const drawer = $('#agentDrawer');
const btnDrawer = $('#btnDrawer');

let generating = false;
let currentRun = null;
let drawerTab = 'orchestrator';

/* ------------------------------------------------ utils */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-icon">${type === 'err' ? '⚠️' : type === 'info' ? 'ℹ️' : '✅'}</span><span>${esc(msg)}</span>`;
  toastsEl.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 4200);
}

function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return ''; }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ------------------------------------------------ router */

// Single toggle path: exactly one of home / roadmap / interview is ever shown.
function showView(el) {
  viewHome.classList.toggle('hidden', el !== viewHome);
  viewRoadmap.classList.toggle('hidden', el !== viewRoadmap);
  viewInterview.classList.toggle('hidden', el !== viewInterview);
  // Home has no run loaded: retract the drawer and its trigger.
  if (el === viewHome) hideDrawerUi();
}

function route() {
  const hash = location.hash || '#/';
  let m = hash.match(/^#\/interview\/([A-Za-z0-9_-]+)$/);
  if (m) return showInterview(m[1]);
  stopPolling();
  m = hash.match(/^#\/rm\/([A-Za-z0-9_-]+)$/);
  if (m) return showRoadmap(m[1]);
  m = hash.match(/^#\/run\/([A-Za-z0-9_-]+)$/);
  if (m) return showRun(m[1]);
  showView(viewHome);
  document.title = 'RoadmapForge — any link → complete roadmap';
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------ library */

async function loadLibrary() {
  try {
    const { roadmaps } = await api('/api/roadmaps');
    libCount.textContent = roadmaps.length;
    emptyEl.classList.toggle('hidden', roadmaps.length > 0);
    cardsEl.innerHTML = roadmaps.map(cardHtml).join('');
    $$('.card-del', cardsEl).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!confirm('Delete this roadmap?')) return;
        try {
          await api(`/api/roadmaps/${btn.dataset.id}`, { method: 'DELETE' });
          toast('Roadmap deleted');
          loadLibrary();
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  } catch (e) {
    toast('Could not load library: ' + e.message, 'err');
  }
}

function reviewBadges(rm) {
  const val = rm.review?.validation;
  if (!val) return '';
  const out = [];
  if (!val.valid) out.push('<span class="tag tag-draft">Draft — incomplete</span>');
  const cov = val.coverage;
  if (cov) {
    const c = cov.concepts || {}, p = cov.pitfalls || {};
    out.push(`<span class="tag">Coverage: concepts ${esc(c.covered ?? 0)}/${esc(c.total ?? 0)} · pitfalls ${esc(p.covered ?? 0)}/${esc(p.total ?? 0)}</span>`);
  }
  return out.join('');
}

function cardHtml(rm) {
  const hue = hueOf(rm.title || rm.id);
  const pct = rm.stepTotal ? Math.round((rm.stepDone / rm.stepTotal) * 100) : 0;
  const srcTag = rm.source?.type === 'link'
    ? `<span class="tag">🔗 ${esc(hostOf(rm.source.value))}</span>`
    : `<span class="tag">💬 topic</span>`;
  const reviewTag = rm.review?.approved
    ? `<span class="tag tag-approved">🛡️ approved · ${rm.review.score}/10</span>`
    : rm.review ? `<span class="tag">🛡️ review ${rm.review.score}/10</span>` : '';
  return `
  <a class="card" href="#/rm/${esc(rm.id)}" style="--hue:${hue}">
    <button class="icon-btn card-del" data-id="${esc(rm.id)}" title="Delete" aria-label="Delete roadmap">🗑</button>
    <div class="card-top">
      <div class="card-emoji">${esc(rm.emoji || '🗺️')}</div>
      <div class="card-title">${esc(rm.title)}</div>
    </div>
    <div class="card-summary">${esc(rm.summary || '')}</div>
    <div class="card-meta">
      <span class="tag diff-${esc(rm.difficulty || 'intermediate')}">${esc(rm.difficulty || 'intermediate')}</span>
      ${rm.estimatedDuration ? `<span class="tag">⏱ ${esc(rm.estimatedDuration)}</span>` : ''}
      <span class="tag">${rm.phaseCount} phases · ${rm.stepTotal} steps</span>
      ${srcTag}${reviewTag}${reviewBadges(rm)}
    </div>
    <div class="card-foot">
      <span class="card-date">${fmtDate(rm.createdAt)}</span>
      ${ringSvg(pct)}
    </div>
  </a>`;
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; }
}

function ringSvg(pct) {
  const r = 15.5, c = 2 * Math.PI * r;
  return `
  <span class="ring" title="${pct}% complete">
    <svg width="40" height="40" viewBox="0 0 40 40">
      <defs><linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7c5cff"/><stop offset="100%" stop-color="#2dd4bf"/>
      </linearGradient></defs>
      <circle class="track" cx="20" cy="20" r="${r}" fill="none" stroke-width="4"/>
      <circle class="bar" cx="20" cy="20" r="${r}" fill="none" stroke-width="4"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/>
    </svg>
    <span class="ring-label">${pct}%</span>
  </span>`;
}

/* ------------------------------------------------ generation (SSE, 3 agents) */

genForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (generating) return;
  const input = genInput.value.trim();
  if (!input) { genInput.focus(); toast('Paste a link or type a topic first', 'info'); return; }
  startBrainstorm(input);
});

$$('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    if (generating) return;
    genInput.value = chip.textContent.trim();
    genForm.requestSubmit();
  });
});

async function streamGeneration(runId) {
  if (generating) return; // one SSE stream per run/tab
  generating = true;
  genBtn.disabled = true;
  genBtn.textContent = 'Agents working…';
  agentbay.classList.remove('hidden');
  bayTitle.textContent = 'Orchestrator is running the agent team…';
  resetAgentCards();
  const activityList = $('#activityList');
  if (activityList) activityList.innerHTML = '';
  addLog('orchestrator', 'Generation started for run: ' + runId);
  openDrawer(currentRun); // watch the agents live as artifacts arrive
  agentbay.scrollIntoView({ behavior: 'smooth', block: 'center' });

  try {
    const res = await fetch(`/api/generate/${runId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let done = false;

    while (true) {
      const { value, done: rdone } = await reader.read();
      if (rdone) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!chunk.startsWith('data:')) continue;
        const evt = JSON.parse(chunk.slice(5).trim());
        handleEvent(evt);
        if (evt.type === 'done' || evt.type === 'error') done = true;
      }
      if (done) break;
    }
  } catch (e) {
    handleEvent({ type: 'error', message: e.message });
  }
}

function resetAgentCards() {
  $$('#agentsGrid .agent-card').forEach((card) => {
    $('.ag-status', card).className = 'ag-status st-waiting';
    $('.ag-status', card).textContent = 'waiting';
    $('.ag-detail', card).textContent = '';
  });
}

const STATUS_LABEL = {
  waiting: 'waiting', working: 'working', done: 'completed', error: 'error',
  revising: 'revising', 'revising-requested': 'corrections sent',
};

function handleEvent(evt) {
  if (evt.type === 'agent') {
    const card = $(`#agentsGrid .agent-card[data-agent="${evt.id}"]`);
    if (card) {
      const cls = evt.status.startsWith('st-') ? evt.status : 'st-' + evt.status;
      $('.ag-status', card).className = 'ag-status ' + cls;
      $('.ag-status', card).textContent = STATUS_LABEL[evt.status] || evt.status;
      if (evt.detail) $('.ag-detail', card).textContent = evt.detail;
    }
    return;
  }
  if (evt.type === 'log') {
    addLog(evt.agent, evt.message);
    return;
  }
  if (evt.type === 'artifact') {
    addLog('orchestrator', `Artifact saved: ${evt.kind}`);
    // Live refresh: refetch the saved run and repaint only if the drawer is open.
    const runId = evt.runId || currentRun?.id;
    if (runId) {
      api('/api/runs/' + runId).then((run) => {
        currentRun = run;
        if (!drawer.classList.contains('hidden')) renderDrawer(run);
      }).catch(() => {});
    }
    return;
  }
  if (evt.type === 'stage') {
    let label = STAGE_LABEL[evt.stage] || evt.stage;
    if (evt.stage === 'expand' && evt.total) label += ` (${evt.index}/${evt.total})`;
    bayTitle.textContent = `Generation stage: ${label}`;
    const status = $('#interviewStatus');
    if (status) status.textContent = `Agents are working… ${label}`;
    return;
  }
  if (evt.type === 'error') {
    bayTitle.textContent = 'Pipeline failed';
    toast(`Generation stage failed: ${evt.message} — check Settings, then retry from the interview.`, 'err');
    endGenerate();
    const status = $('#interviewStatus');
    if (status) status.textContent = `Generation failed: ${evt.message} — use Retry generation to try again.`;
    if (currentRun && !viewInterview.classList.contains('hidden')) renderRetryCard(currentRun.id);
    return;
  }
  if (evt.type === 'done') {
    bayTitle.textContent = 'Roadmap ready 🎉';
    genInput.value = '';
    setTimeout(() => {
      endGenerate();
      stopPolling();
      location.hash = `#/run/${evt.run.id}`;
    }, 900);
  }
}

function addLog(agent, message) {
  const list = $('#activityList');
  if (!list) return; // SSE can stream while the home/interview view is hidden
  const el = document.createElement('div');
  el.className = 'log-line';
  el.innerHTML = `<span class="log-agent la-${esc(agent)}">${esc(agent)}</span><span class="log-msg">${esc(message)}</span><span class="log-ts">${fmtTime(Date.now())}</span>`;
  list.appendChild(el);
  list.scrollTop = list.scrollHeight;
}

function endGenerate() {
  generating = false;
  genBtn.disabled = false;
  genBtn.textContent = 'Forge roadmap';
  setTimeout(() => agentbay.classList.add('hidden'), 400);
  loadLibrary();
}

/* ------------------------------------------------ interview (superpowers brainstorm) */

// The answer form is static markup, so its listeners are bound exactly once.
$('#answerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#answerInput');
  const text = input.value.trim();
  if (!text) { input.focus(); toast('Type an answer, or use Skip / You decide', 'info'); return; }
  submitAnswer(text);
});
$('#btnSkip').addEventListener('click', () => submitAnswer('Skip'));
$('#btnDecide').addEventListener('click', () => submitAnswer('You decide'));

const STAGE_LABEL = {
  methods: 'loading methodology',
  expand: 'expanding phases',
  revise: 'revising draft',
  validate: 'validating roadmap',
  repair: 'repairing gaps',
};

async function startBrainstorm(input) {
  if (generating) return;
  generating = true;
  genBtn.disabled = true;
  genBtn.textContent = 'Researching…';
  try {
    const res = await api('/api/brainstorm/start', { method: 'POST', body: { input } });
    location.hash = `#/interview/${res.runId || res.run.id}`;
  } catch (e) {
    toast(`Brainstorm start failed: ${e.message} — check Settings, then retry.`, 'err');
  } finally {
    generating = false;
    genBtn.disabled = false;
    genBtn.textContent = 'Forge roadmap';
  }
}

let pollTimer = null;
let pollToken = 0;

function stopPolling() {
  pollToken++;
  if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
}

// Refresh safety: never open a second SSE stream. Poll the saved run instead.
function startPolling(runId) {
  stopPolling();
  const token = pollToken;
  let polls = 0;
  const tick = async () => {
    if (token !== pollToken) return;
    polls++;
    try {
      const run = await api(`/api/runs/${runId}`);
      if (token !== pollToken) return;
      currentRun = run;
      if (run.stage === 'done') {
        stopPolling();
        location.hash = `#/run/${runId}`;
        return;
      }
      if (run.stage === 'failed') {
        stopPolling();
        renderInterview(run);
        return;
      }
      if (polls >= 20) {
        stopPolling();
        renderRetryCard(runId);
        return;
      }
      const status = $('#interviewStatus');
      if (status) status.textContent = 'Agents are working… checking progress.';
      bayTitle.textContent = 'Agents are working… checking progress.';
      pollTimer = setTimeout(tick, 2000);
    } catch (e) {
      if (token !== pollToken) return;
      const status = $('#interviewStatus');
      if (status) status.textContent = `Progress check failed: ${e.message} — retrying.`;
      pollTimer = setTimeout(tick, 2000);
    }
  };
  pollTimer = setTimeout(tick, 2000);
}

async function showInterview(id) {
  stopPolling();
  showView(viewInterview);
  window.scrollTo(0, 0);
  $('#interviewSub').textContent = '';
  $('#qProgress').innerHTML = '';
  $('#chat').innerHTML = '<div class="bubble ai">Loading interview…</div>';
  $('#answerForm').classList.add('hidden');
  let run;
  try {
    run = await api(`/api/runs/${id}`);
  } catch (e) {
    currentRun = null;
    hideDrawerUi();
    document.title = 'Interview unavailable — RoadmapForge';
    $('#chat').innerHTML = `<div class="bubble ai">Interview stage could not load: ${esc(e.message)}. <a href="#/">Go back to the library</a> and start a new brainstorm.</div>`;
    return;
  }
  if (run.stage === 'done') { location.hash = `#/run/${id}`; return; }
  currentRun = run;
  btnDrawer.classList.remove('hidden');
  if (!drawer.classList.contains('hidden')) renderDrawer(run);
  document.title = 'Brainstorm — RoadmapForge';
  renderInterview(run);
  // An SSE already streaming in this tab reports progress; only a refresh needs polling.
  if (run.stage === 'generating' && !generating) startPolling(id);
}

function renderInterview(run) {
  currentRun = run;
  const stage = run.stage;
  const answers = run.answers || [];
  const pending = run.pendingQuestion;

  $('#interviewSub').textContent = `Topic: ${run.input}`;
  const dots = answers.length + (pending ? 1 : 0);
  $('#qProgress').innerHTML = Array.from({ length: Math.max(dots, 1) }, (_, i) =>
    `<span class="q-dot${i < answers.length || (pending && i === answers.length) ? ' on' : ''}"></span>`).join('');

  let html = answers.map((a) => `
    <div class="bubble ai"><span class="b-who">Interviewer</span>${esc(a.q)}</div>
    <div class="bubble user"><span class="b-who">You</span>${esc(a.a)}</div>`).join('');

  $('#answerForm').classList.toggle('hidden', stage !== 'questions');

  if (stage === 'questions') {
    if (pending) html += `<div class="bubble ai"><span class="b-who">Interviewer</span>${esc(pending)}</div>`;
    html += `<div class="bubble ai"><span class="b-who">Status</span>Question ${answers.length + 1} — answer, skip, or let us decide.</div>`;
    setAnswerBusy(false);
  } else if (stage === 'playback') {
    const pb = run.playback || {};
    html += `<div class="bubble ai"><span class="b-who">Interviewer · playback</span>${esc(pb.summary || 'Here is what I understood:')}
      ${(pb.bullets || []).length ? `<ul>${pb.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${(pb.openQuestions || []).length ? `<p><b>Open questions:</b> ${pb.openQuestions.map(esc).join(' · ')}</p>` : ''}</div>`;
    html += `<div class="bubble user wide">
      <b>Looks good?</b>
      <div class="answer-actions">
        <button class="btn btn-ghost btn-sm" id="btnChange" type="button">Change something</button>
        <button class="btn btn-primary btn-sm" id="btnLooksRight" type="button">Looks right</button>
      </div>
      <div id="editBox" class="hidden" style="margin-top:10px">
        <textarea id="editInput" rows="3" placeholder="What should change?" style="width:100%;resize:vertical;border:1px solid var(--border);border-radius:10px;background:rgba(7,7,13,.8);color:var(--text);font:inherit;padding:10px;outline:none"></textarea>
        <div class="answer-actions"><button class="btn btn-primary btn-sm" id="btnSendEdit" type="button">Send corrections</button></div>
      </div></div>`;
  } else if (stage === 'approaches') {
    const list = run.approaches || [];
    html += `<div class="bubble ai"><span class="b-who">Interviewer · approaches</span>Pick the path you want the agents to plan.</div>`;
    html += `<div class="approach-grid">${list.map((a) => `
      <button class="approach${a.id === run.recommendedApproachId ? ' sel' : ''}" data-approach="${esc(a.id)}" type="button">
        <b>${esc(a.title)}</b><span>${esc(a.description)}</span><small>${esc(a.tradeoffs)}</small>
      </button>`).join('')}</div>`;
    html += `<div class="answer-actions start"><button class="btn btn-primary btn-sm" id="btnContinue" type="button" ${list.length ? '' : 'disabled'}>Continue</button></div>`;
  } else if (stage === 'ready') {
    html += `<div class="bubble ai"><span class="b-who">Interviewer · ready</span>Approach chosen: <b>${esc(run.chosenApproach?.title || 'default')}</b>. Ready to build the roadmap.</div>`;
    html += `<div class="bubble user wide"><button class="btn btn-primary" id="btnStartGen" type="button">Start generation</button></div>`;
  } else if (stage === 'generating') {
    html += `<div class="bubble ai"><span class="b-who">Generation stage</span><span id="interviewStatus">Agents are working…</span></div>`;
  } else if (stage === 'failed') {
    html += `<div class="bubble ai"><span class="b-who">Generation stage · failed</span>${esc(run.error || 'Unknown error')}<br>
      <small>Next step: check Settings (AI endpoint, key, model, methodology), then retry generation.</small></div>`;
    html += `<div class="bubble user wide"><button class="btn btn-primary" id="btnRetry" type="button">Retry generation</button></div>`;
  } else {
    html += `<div class="bubble ai"><span class="b-who">Stage: ${esc(stage)}</span>No controls for this stage yet. <a href="#/">Go back to the library</a> and start a new brainstorm for this topic.</div>`;
  }

  $('#chat').innerHTML = html;

  if (stage === 'playback') {
    $('#btnLooksRight')?.addEventListener('click', () => confirmPlayback('approve'));
    $('#btnChange')?.addEventListener('click', () => $('#editBox')?.classList.remove('hidden'));
    $('#btnSendEdit')?.addEventListener('click', () => {
      const edits = ($('#editInput')?.value || '').trim();
      if (!edits) { toast('Describe what should change', 'info'); return; }
      confirmPlayback('edit', edits);
    });
  } else if (stage === 'approaches') {
    const cards = $$('.approach', $('#chat'));
    cards.forEach((card) => card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.toggle('sel', c === card));
    }));
    $('#btnContinue')?.addEventListener('click', () => {
      const sel = $('.approach.sel', $('#chat'));
      if (!sel) { toast('Pick an approach first', 'info'); return; }
      chooseApproach(sel.dataset.approach);
    });
  } else if (stage === 'ready') {
    $('#btnStartGen')?.addEventListener('click', () => {
      currentRun = { ...run, stage: 'generating' };
      renderInterview(currentRun);
      streamGeneration(run.id);
    });
  } else if (stage === 'failed') {
    $('#btnRetry')?.addEventListener('click', () => {
      currentRun = { ...run, stage: 'generating' };
      renderInterview(currentRun);
      streamGeneration(run.id);
    });
  }
}

function setAnswerBusy(busy) {
  ['#answerInput', '#btnAnswer', '#btnSkip', '#btnDecide'].forEach((sel) => {
    const el = $(sel);
    if (el) el.disabled = busy;
  });
}

async function submitAnswer(text) {
  if (!currentRun) return;
  const runId = currentRun.id;
  setAnswerBusy(true);
  try {
    const res = await api(`/api/runs/${runId}/answer`, { method: 'POST', body: { answer: text } });
    currentRun = res.run;
    renderInterview(res.run);
    const input = $('#answerInput');
    if (input) { input.value = ''; input.focus(); }
  } catch (e) {
    toast(`Question stage failed: ${e.message} — try again or go Back.`, 'err');
  } finally {
    setAnswerBusy(false);
  }
}

async function confirmPlayback(action, edits) {
  if (!currentRun) return;
  const runId = currentRun.id;
  const buttons = ['#btnLooksRight', '#btnChange', '#btnSendEdit'].map((s) => $(s)).filter(Boolean);
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const res = await api(`/api/runs/${runId}/confirm`, { method: 'POST', body: { action, edits } });
    currentRun = res.run;
    renderInterview(res.run);
  } catch (e) {
    toast(`Playback stage failed: ${e.message} — try again or go Back.`, 'err');
    buttons.forEach((b) => { b.disabled = false; });
  }
}

async function chooseApproach(id) {
  if (!currentRun) return;
  const runId = currentRun.id;
  const btn = $('#btnContinue');
  if (btn) btn.disabled = true;
  try {
    const res = await api(`/api/runs/${runId}/approach`, { method: 'POST', body: { approachId: id } });
    currentRun = { ...res.run, stage: 'generating' };
    renderInterview(currentRun);
    streamGeneration(runId);
  } catch (e) {
    toast(`Approach stage failed: ${e.message} — pick another approach and try again.`, 'err');
    if (btn) btn.disabled = false;
  }
}

function renderRetryCard(runId) {
  const chat = $('#chat');
  if (!chat || $('#btnRetryPoll')) return;
  const el = document.createElement('div');
  el.className = 'bubble ai';
  el.innerHTML = `<span class="b-who">Generation stage</span>
    Agents are taking longer than expected. Check the run status, then retry generation — the server rejects a real duplicate.
    <div class="answer-actions start"><button class="btn btn-primary btn-sm" id="btnRetryPoll" type="button">Retry generation</button></div>`;
  chat.appendChild(el);
  $('#btnRetryPoll').addEventListener('click', () => {
    $('#btnRetryPoll').disabled = true;
    if (currentRun) {
      currentRun = { ...currentRun, stage: 'generating' };
      renderInterview(currentRun);
    }
    streamGeneration(runId);
  });
}

$('#btnDemo').addEventListener('click', async () => {
  try {
    const rm = await api('/api/demo', { method: 'POST', body: {} });
    toast('Demo roadmap loaded');
    location.hash = `#/rm/${rm.id}`;
  } catch (e) { toast(e.message, 'err'); }
});

/* ------------------------------------------------ run dashboard (4 tabs) */

let currentRm = null;

async function showRun(id) {
  showView(viewRoadmap);
  window.scrollTo(0, 0);
  viewRoadmap.innerHTML = `<div class="rm-head" style="color:var(--text-faint)">Loading run…</div>`;
  let run;
  try { run = await api(`/api/runs/${id}`); }
  catch (e) {
    hideDrawerUi();
    viewRoadmap.innerHTML = `<div class="rm-head"><a href="#/" class="back-link">← Back to library</a>
      <p style="margin-top:20px;color:var(--bad)">${esc(e.message)}</p></div>`;
    return;
  }
  currentRun = run;
  btnDrawer.classList.remove('hidden');
  if (!drawer.classList.contains('hidden')) renderDrawer(run);
  document.title = `Agent Run — RoadmapForge`;
  viewRoadmap.innerHTML = runDashboardHtml(run);
  bindRunDashboard(run);
}

function runDashboardHtml(run) {
  const ag = run.agents || {};
  const completed = Object.values(ag).filter((a) => a.status === 'done').length;
  const working = Object.values(ag).filter((a) => ['working', 'revising'].includes(a.status)).length;
  const allLogs = collectLogs(run);

  const agentCards = Object.entries(ag).map(([key, a], i) => `
    <div class="run-agent-card" data-agent="${key}">
      <div class="ag-top">
        <span class="ag-icon">${a.icon || '🤖'}</span>
        <div class="ag-name"><b>${esc(a.label)} <span class="muted">#${String(i + 1).padStart(2, '0')}</span></b><small>${esc(a.mcp || '')}</small></div>
        <span class="ag-status st-${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span>
      </div>
      <div class="run-agent-meta">
        ${a.tool ? `<span class="tag">🧰 ${esc(a.tool)}</span>` : ''}
        ${a.startedAt && a.endedAt ? `<span class="tag">⏱ ${Math.max(1, Math.round((a.endedAt - a.startedAt) / 1000))}s</span>` : ''}
        ${a.logs?.length ? `<span class="tag">${a.logs.length} actions</span>` : ''}
      </div>
      ${a.detail ? `<div class="run-agent-detail">${esc(a.detail)}</div>` : ''}
    </div>`).join('');

  return `
  <div class="rm-head">
    <a href="#/" class="back-link">← Back to library</a>
    <h1 class="rm-title" style="margin-top:16px">Agent Pipeline Dashboard</h1>
    <p class="rm-summary">Task: <b>${esc(run.input)}</b> · ${run.rounds || 1} round(s) · ${run.approved ? '<span class="tag tag-approved">🛡️ Reviewer approved</span>' : '<span class="tag">published with review notes</span>'}</p>
    <div class="stat-row">
      <div class="stat"><b>${Object.keys(ag).length}</b><span>Agents</span></div>
      <div class="stat"><b>${working}</b><span>Working</span></div>
      <div class="stat"><b>${completed}</b><span>Completed</span></div>
    </div>

    <div class="tabs" id="runTabs">
      <button class="tab active" data-tab="activity" type="button">Live Activity</button>
      <button class="tab" data-tab="agents" type="button">Agents</button>
      <button class="tab" data-tab="artifacts" type="button">Artifacts</button>
      <button class="tab" data-tab="roadmap" type="button">Final Roadmap</button>
    </div>
  </div>

  <div class="tab-pane" data-pane="activity">
    <div class="activity standalone">
      <div class="activity-list expanded" id="runActivity">${allLogs.map(logLineHtml).join('')}</div>
    </div>
  </div>

  <div class="tab-pane hidden" data-pane="agents">
    <div class="run-agents">${agentCards}</div>
  </div>

  <div class="tab-pane hidden" data-pane="artifacts">
    ${artifactsHtml(run)}
  </div>

  <div class="tab-pane hidden" data-pane="roadmap" id="runRoadmapPane">
    <div class="rm-section-title">Final Roadmap</div>
    <div id="runRoadmapSlot" style="color:var(--text-faint)">Loading…</div>
  </div>`;
}

function collectLogs(run) {
  const ag = run.agents || {};
  let logs = [];
  for (const [key, a] of Object.entries(ag)) {
    (a.logs || []).forEach((l) => logs.push({ ...l, agent: key }));
  }
  (run.orchestratorLog || []).forEach((l) => logs.push(l));
  logs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return logs;
}

function logLineHtml(l) {
  return `<div class="log-line"><span class="log-agent la-${esc(l.agent)}">${esc(l.agent)}</span><span class="log-msg">${esc(l.message)}</span><span class="log-ts">${fmtTime(l.ts)}</span></div>`;
}

function artifactsHtml(run) {
  const r = run.artifacts || {};
  const parts = [];
  if (r.research) {
    const rs = r.research;
    parts.push(`
    <div class="artifact-card">
      <div class="artifact-head">🔎 Research Report — Agent 1</div>
      <h3 class="artifact-title">${esc(rs.topic || '')}</h3>
      <p class="artifact-p">${esc(rs.purpose || '')}</p>
      ${rs.audience ? `<p class="artifact-p"><b>Audience:</b> ${esc(rs.audience)}</p>` : ''}
      ${listSection('Key concepts', rs.keyConcepts)}
      ${listSection('What it unlocks', rs.features)}
      ${listSection('Prerequisites', rs.prerequisites)}
      ${listSection('Common pitfalls', rs.pitfalls)}
      ${(rs.resources || []).length ? `<div class="s-res">${rs.resources.map((x) => x.url ? `<a class="res-pill" href="${esc(x.url)}" target="_blank" rel="noopener">📄 <span>${esc(x.label)}</span></a>` : `<span class="tag">${esc(x.label)}</span>`).join('')}</div>` : ''}
      ${(rs.sources || []).length ? `<div class="s-res">${rs.sources.map((x) => x.url ? `<a class="res-pill" href="${esc(x.url)}" target="_blank" rel="noopener">🔗 <span>${esc(x.label)}</span></a>` : `<span class="tag">${esc(x.label)}</span>`).join('')}</div>` : ''}
    </div>`);
  }
  if (r.interview) {
    const iv = r.interview;
    const answers = iv.answers || [];
    const playback = iv.playback || {};
    const chosen = iv.chosenApproach || {};
    parts.push(`
    <div class="artifact-card">
      <div class="artifact-head">💬 Interview — Interviewer</div>
      ${answers.length ? `<div class="artifact-section">${answers.map((a) => `<p class="artifact-p"><b>${esc(a.q || '')}</b><br>${esc(a.a || '')}</p>`).join('')}</div>` : ''}
      ${playback.summary ? `<p class="artifact-p"><b>Playback:</b> ${esc(playback.summary)}</p>` : ''}
      ${(playback.bullets || []).length ? listSection('Playback bullets', playback.bullets) : ''}
      ${(playback.openQuestions || []).length ? `<p class="artifact-p"><b>Open questions:</b> ${playback.openQuestions.map(esc).join(' · ')}</p>` : ''}
      ${chosen.title ? `<p class="artifact-p"><b>Chosen approach:</b> ${esc(chosen.title)}</p>` : ''}
    </div>`);
  }
  if (r.review) {
    const rv = r.review;
    parts.push(`
    <div class="artifact-card">
      <div class="artifact-head">🛡️ Review Report — Agent 3</div>
      <p class="artifact-p"><b class="${rv.approved ? 'txt-good' : 'txt-warn'}">${rv.approved ? 'APPROVED' : 'CORRECTIONS REQUESTED'}</b> · Quality score: <b>${esc(rv.score)}/10</b> ${run.rounds > 1 ? `· ${run.rounds} review round(s)` : ''}</p>
      ${(rv.checklist || []).length ? `<div class="checklist">${rv.checklist.map((c) => `
        <div class="check-item ${c.passed ? 'pass' : 'fail'}"><span class="ci-icon">${c.passed ? '✓' : '✗'}</span><div><b>${esc(c.item)}</b> <span class="muted">— ${esc(c.note || '')}</span></div></div>`).join('')}</div>` : ''}
      ${(rv.issues || []).length ? `<div class="review-issues">${rv.issues.map((i) => `<div class="issue">⚠️ <b>${esc(i.problem)}</b> → ${esc(i.fix)}</div>`).join('')}</div>` : ''}
    </div>`);
  }
  if (r.roadmapDraft && r.roadmap && r.roadmapDraft.title !== r.roadmap.title) {
    parts.push(`<div class="artifact-card"><div class="artifact-head">📐 Roadmap drafts — Agent 2</div><p class="artifact-p muted">Round 1: "${esc(r.roadmapDraft.title)}" → revised after review → "${esc(r.roadmap.title)}"</p></div>`);
  }
  return parts.length ? parts.join('') : '<p class="muted" style="padding:20px 0">No artifacts saved for this run.</p>';
}

function listSection(title, items) {
  if (!items || !items.length) return '';
  return `<div class="artifact-section"><b>${esc(title)}</b><div class="phase-skills">${items.map((i) => `<span class="tag">${esc(i)}</span>`).join('')}</div></div>`;
}

function bindRunDashboard(run) {
  // tabs
  $$('#runTabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('#runTabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.tab-pane', viewRoadmap).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab.dataset.tab));
    });
  });

  // final roadmap tab — lazy load + full step binding (progress tracking works here too)
  const slot = $('#runRoadmapSlot');
  if (slot && run.finalRoadmapId) {
    api(`/api/roadmaps/${run.finalRoadmapId}`).then((rm) => {
      currentRm = rm;
      slot.innerHTML = roadmapHtml(rm);
      bindRoadmap(rm, slot);
    }).catch((e) => { slot.innerHTML = `<p style="color:var(--bad)">${esc(e.message)}</p>`; });
  } else if (slot) {
    slot.innerHTML = `<p class="muted">This run did not publish a roadmap.</p>`;
  }
}

/* ------------------------------------------------ agent drawer (per-agent tabs) */

// No run attached (home / saved roadmap): retract the trigger and close the panel.
function hideDrawerUi() {
  btnDrawer.classList.add('hidden');
  drawer.classList.add('hidden');
}

function openDrawer(run) {
  currentRun = run || currentRun;
  drawer.classList.remove('hidden');
  renderDrawer(currentRun);
}

function drawerSection(title, body) {
  return `<div class="drawer-section"><h4>${esc(title)}</h4>${body}</div>`;
}

// Raw JSON is rendered in full — never sliced. The <pre> scrolls via CSS instead.
function rawDetails(label, data) {
  return `<details class="drawer-section"><summary>Raw JSON · ${esc(label)}</summary>
    <button class="btn btn-ghost btn-sm drawer-copy" type="button">Copy JSON</button>
    <pre class="drawer-pre drawer-json">${esc(JSON.stringify(data ?? null, null, 2))}</pre></details>`;
}

function sourcePills(title, items) {
  if (!items || !items.length) return '';
  const pills = items.map((x) => {
    const label = typeof x === 'string' ? x : (x.label || x.title || x.url || '');
    const url = typeof x === 'string' ? '' : x.url;
    return url
      ? `<a class="res-pill" href="${esc(url)}" target="_blank" rel="noopener">🔗 <span>${esc(label)}</span></a>`
      : `<span class="tag">${esc(label)}</span>`;
  }).join('');
  return `<div class="drawer-section"><h4>${esc(title)}</h4><div class="s-res">${pills}</div></div>`;
}

function roadmapBrief(label, rm) {
  if (!rm) return '';
  const phases = rm.phases || [];
  const phaseHtml = phases.map((p) => `
    <li>${esc(p.title || '')}${p.goal ? ` — ${esc(p.goal)}` : ''}
      ${(p.steps || []).length ? `<ul>${(p.steps || []).map((s) => `<li>${esc(s.title || '')}${s.detail ? `: ${esc(s.detail)}` : ''}</li>`).join('')}</ul>` : ''}
    </li>`).join('');
  return drawerSection(label, `
    <p><b>${esc(rm.emoji || '')} ${esc(rm.title || '')}</b></p>
    ${rm.summary ? `<p>${esc(rm.summary)}</p>` : ''}
    ${rm.difficulty || rm.estimatedDuration ? `<p class="muted">Difficulty: ${esc(rm.difficulty || '—')} · Duration: ${esc(rm.estimatedDuration || '—')}</p>` : ''}
    ${(rm.principles || []).length ? `<p><b>Principles:</b> ${rm.principles.map(esc).join(' · ')}</p>` : ''}
    ${rm.milestoneProject ? `<p><b>Milestone:</b> ${esc(rm.milestoneProject)}</p>` : ''}
    <p><b>${phases.length} phase(s)</b></p>
    ${phases.length ? `<ol>${phaseHtml}</ol>` : '<p class="muted">No phases in this artifact.</p>'}`);
}

function orchestratorDrawer(run) {
  const log = run.orchestratorLog || [];
  const status = {
    status: run.status || 'unknown',
    stage: run.stage || '(legacy run — no stage field)',
    rounds: run.rounds ?? 0,
    approved: run.approved ?? null,
    repairs: run.repairs ?? 0,
    validation: run.validation || null,
    startedAt: run.startedAt || null,
    endedAt: run.endedAt || null,
  };
  const logHtml = log.length
    ? log.map((l) => `<div class="log-line"><span class="log-agent la-orchestrator">${esc(l.agent || 'orchestrator')}</span><span class="log-msg">${esc(l.message || '')}</span><span class="log-ts">${fmtTime(l.ts)}</span></div>`).join('')
    : '<p class="muted">No orchestrator log for this run.</p>';
  return drawerSection('Run status', `<pre class="drawer-pre">${esc(JSON.stringify(status, null, 2))}</pre>`)
    + drawerSection(`Orchestrator log (${log.length})`, logHtml)
    + rawDetails('orchestratorLog', log);
}

function researcherDrawer(art) {
  const rs = art.research;
  if (!rs) return '<p class="muted">No research artifact saved for this run yet.</p>' + rawDetails('research', null);
  return drawerSection('Research report', `
      <p><b>${esc(rs.topic || '')}</b></p>
      ${rs.purpose ? `<p>${esc(rs.purpose)}</p>` : ''}
      ${rs.audience ? `<p><b>Audience:</b> ${esc(rs.audience)}</p>` : ''}`)
    + listSection('Key concepts', rs.keyConcepts)
    + listSection('Features / unlocks', rs.features)
    + listSection('Prerequisites', rs.prerequisites)
    + listSection('Common pitfalls', rs.pitfalls)
    + listSection('Learning order', rs.learningOrder)
    + listSection('Tools ecosystem', rs.toolsEcosystem)
    + sourcePills('Resources', rs.resources)
    + sourcePills('Sources', rs.sources)
    + rawDetails('research', rs);
}

function interviewerDrawer(run, art) {
  const iv = art.interview || {};
  const answers = run.answers || iv.answers || [];
  const pending = run.pendingQuestion || iv.pendingQuestion || null;
  const playback = run.playback || iv.playback || null;
  const approaches = run.approaches || iv.approaches || [];
  const chosen = run.chosenApproach || iv.chosenApproach || null;

  const transcript = answers.length
    ? answers.map((a, i) => `<div class="drawer-section"><h4>Question ${i + 1}</h4><p><b>${esc(a.q || '')}</b></p><p>${esc(a.a || '')}</p></div>`).join('')
    : '<p class="muted">No interview answers for this run.</p>';
  let html = drawerSection(`Interview transcript (${answers.length})`, transcript);
  if (pending) html += drawerSection('Pending question', `<p>${esc(pending)}</p>`);
  if (playback) {
    html += drawerSection('Playback', `
      ${playback.summary ? `<p>${esc(playback.summary)}</p>` : ''}
      ${(playback.bullets || []).length ? `<ul>${playback.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${(playback.openQuestions || []).length ? `<p><b>Open questions:</b> ${playback.openQuestions.map(esc).join(' · ')}</p>` : ''}`);
  }
  if (approaches.length) {
    html += drawerSection('Approaches', approaches.map((a) => `
      <div class="check-item${a.id === chosen?.id ? ' pass' : ''}"><span class="ci-icon">${a.id === chosen?.id ? '✓' : '○'}</span>
      <div><b>${esc(a.title || '')}</b> <span class="muted">${esc(a.description || '')}</span>${a.tradeoffs ? `<br><small>${esc(a.tradeoffs)}</small>` : ''}</div></div>`).join(''));
  }
  if (chosen) html += drawerSection('Chosen approach', `<p><b>${esc(chosen.title || '')}</b></p><p>${esc(chosen.description || '')}</p>`);
  html += rawDetails('interview', { answers, pendingQuestion: pending, playback, approaches, chosenApproach: chosen });
  return html;
}

function plannerDrawer(art) {
  const parts = [];
  if (art.outline) parts.push(roadmapBrief('Outline', art.outline));
  if (art.roadmapDraft) parts.push(roadmapBrief('Roadmap draft', art.roadmapDraft));
  if (art.roadmap) parts.push(roadmapBrief('Final roadmap', art.roadmap));
  if (!parts.length) parts.push('<p class="muted">No planner artifacts saved for this run yet.</p>');
  parts.push(rawDetails('planner', {
    outline: art.outline || null,
    roadmapDraft: art.roadmapDraft || null,
    roadmap: art.roadmap || null,
  }));
  return parts.join('');
}

function reviewerDrawer(run, art) {
  const rv = art.review;
  if (!rv) return '<p class="muted">No review artifact saved for this run yet.</p>' + rawDetails('review', null);
  const validation = run.validation || rv.validation || null;
  let html = drawerSection('Review result', `
    <p><b class="${rv.approved ? 'txt-good' : 'txt-warn'}">${rv.approved ? 'APPROVED' : 'CORRECTIONS REQUESTED'}</b>
      · Score: ${esc(rv.score ?? '—')}/10 · Rounds: ${esc(run.rounds ?? 1)}</p>
    ${validation ? `<pre class="drawer-pre">${esc(JSON.stringify(validation, null, 2))}</pre>` : '<p class="muted">No validation record for this run.</p>'}`);
  if ((rv.checklist || []).length) {
    html += drawerSection('Checklist', `<div class="checklist">${rv.checklist.map((c) => `
      <div class="check-item ${c.passed ? 'pass' : 'fail'}"><span class="ci-icon">${c.passed ? '✓' : '✗'}</span>
      <div><b>${esc(c.item || '')}</b> <span class="muted">— ${esc(c.note || '')}</span></div></div>`).join('')}</div>`);
  }
  if ((rv.issues || []).length) {
    html += drawerSection('Issues', `<div class="review-issues">${rv.issues.map((i) => `<div class="issue">⚠️ <b>${esc(i.problem || '')}</b> → ${esc(i.fix || '')}</div>`).join('')}</div>`);
  }
  html += rawDetails('review', validation ? { review: rv, validation } : rv);
  return html;
}

function renderDrawer(run) {
  const r = run || {};
  const art = r.artifacts || {};
  let html = '';
  if (drawerTab === 'orchestrator') html = orchestratorDrawer(r);
  else if (drawerTab === 'researcher') html = researcherDrawer(art);
  else if (drawerTab === 'interviewer') html = interviewerDrawer(r, art);
  else if (drawerTab === 'planner') html = plannerDrawer(art);
  else if (drawerTab === 'reviewer') html = reviewerDrawer(r, art);
  $('#drawerBody').innerHTML = html;
  $$('#drawerTabs .dtab').forEach((t) => t.classList.toggle('active', t.dataset.tab === drawerTab));
}

function bindDrawerTabs() {
  $$('#drawerTabs .dtab').forEach((tab) => {
    tab.addEventListener('click', () => {
      drawerTab = tab.dataset.tab;
      renderDrawer(currentRun);
    });
  });
}

function bindDrawer() {
  btnDrawer.addEventListener('click', () => openDrawer(currentRun));
  $('#drawerClose').addEventListener('click', () => drawer.classList.add('hidden'));
  bindDrawerTabs();
  // Delegated once: copies the full raw JSON for the expanded section.
  $('#drawerBody').addEventListener('click', (e) => {
    const btn = e.target.closest('.drawer-copy');
    if (!btn) return;
    const pre = btn.parentElement.querySelector('.drawer-json');
    if (!pre || !navigator.clipboard?.writeText) {
      toast('Clipboard unavailable — select the JSON text to copy', 'info');
      return;
    }
    navigator.clipboard.writeText(pre.textContent).then(
      () => toast('Raw JSON copied'),
      () => toast('Could not copy — select the JSON text manually', 'err'),
    );
  });
}

/* ------------------------------------------------ roadmap view */

async function showRoadmap(id) {
  showView(viewRoadmap);
  hideDrawerUi(); // saved roadmap view has no live run attached
  window.scrollTo(0, 0);
  viewRoadmap.innerHTML = `<div class="rm-head" style="color:var(--text-faint)">Loading roadmap…</div>`;
  let rm;
  try { rm = await api(`/api/roadmaps/${id}`); }
  catch (e) {
    viewRoadmap.innerHTML = `<div class="rm-head"><a href="#/" class="back-link">← Back to library</a>
      <p style="margin-top:20px;color:var(--bad)">${esc(e.message)}</p></div>`;
    return;
  }
  currentRm = rm;
  document.title = `${rm.title} — RoadmapForge`;
  viewRoadmap.innerHTML = roadmapHtml(rm);
  bindRoadmap(rm, viewRoadmap);
  loadLibrary();
}

function roadmapHtml(rm) {
  const hue = hueOf(rm.title || rm.id);
  const phases = rm.phases || [];
  let total = 0, done = 0;
  for (const p of phases) for (const s of p.steps || []) { total++; if (rm.progress?.[s.id]) done++; }
  const pct = total ? Math.round((done / total) * 100) : 0;

  const srcTag = rm.source?.type === 'link'
    ? `<span class="tag">🔗 <a href="${esc(rm.source.value)}" target="_blank" rel="noopener">${esc(hostOf(rm.source.value))}</a></span>`
    : `<span class="tag">💬 ${esc(rm.source?.value || 'topic')}</span>`;

  const principles = (rm.principles || []).map((p) => `
    <div class="principle"><span class="p-icon">◆</span><span>${esc(p)}</span></div>`).join('');

  const timeline = phases.map((p, i) => {
    const pDone = (p.steps || []).filter((s) => rm.progress?.[s.id]).length;
    const pTotal = (p.steps || []).length;
    const complete = pTotal > 0 && pDone === pTotal;
    const steps = (p.steps || []).map((s) => `
      <div class="step ${rm.progress?.[s.id] ? 'done' : ''}" data-step="${esc(s.id)}">
        <span class="checkbox" aria-hidden="true"></span>
        <div class="s-body">
          <div class="s-title">${esc(s.title)}${s.hours ? `<span class="hours-pill">⏳ ${esc(s.hours)}h</span>` : ''}</div>
          ${s.detail ? `<div class="s-detail">${esc(s.detail)}</div>` : ''}
          ${s.verify ? `<div class="s-verify"><b>✓ Self-check:</b> ${esc(s.verify)}</div>` : ''}
          ${(s.resources || []).length ? `<div class="s-res">${s.resources.map((r) => `
            <a class="res-pill" href="${esc(r.url)}" target="_blank" rel="noopener">📄 <span>${esc(r.label)}</span></a>`).join('')}
          </div>` : ''}
        </div>
      </div>`).join('');
    return `
    <div class="phase ${complete ? 'complete' : ''}">
      <div class="phase-node">${complete ? '✓' : i + 1}</div>
      <div class="phase-card">
        <div class="phase-head">
          <div class="phase-title-row">
            <span class="phase-title">${esc(p.title)}</span>
            ${p.duration ? `<span class="phase-duration">${esc(p.duration)}</span>` : ''}
          </div>
          ${p.goal ? `<div class="phase-goal">🎯 ${esc(p.goal)}</div>` : ''}
          ${(p.skills || []).length ? `<div class="phase-skills">${p.skills.map((sk) => `<span class="tag">${esc(sk)}</span>`).join('')}</div>` : ''}
          ${p.miniProject ? `<div class="phase-miniproject"><b>🛠️ Build this phase:</b> ${esc(p.miniProject)}</div>` : ''}
          ${(p.checklist || []).length ? `<details class="phase-checklist"><summary>✅ Phase checkpoints (${p.checklist.length})</summary><ul>${p.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
        </div>
        <div class="steps">${steps}</div>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="rm-head" style="--hue:${hue}">
    <div class="rm-title-row">
      <div class="rm-emoji">${esc(rm.emoji || '🗺️')}</div>
      <h1 class="rm-title">${esc(rm.title)}</h1>
      <div class="rm-actions">
        <button class="btn btn-ghost btn-sm" id="btnMd" type="button">⬇ Export Markdown</button>
        <button class="btn btn-ghost btn-sm" id="btnJson" type="button">⧉ Copy JSON</button>
        <button class="btn btn-danger btn-sm" id="btnRmDel" type="button">Delete</button>
      </div>
    </div>
    ${rm.summary ? `<p class="rm-summary">${esc(rm.summary)}</p>` : ''}
    <div class="rm-meta">
      <span class="tag diff-${esc(rm.difficulty || 'intermediate')}">${esc(rm.difficulty || 'intermediate')}</span>
      ${rm.estimatedDuration ? `<span class="tag">⏱ ${esc(rm.estimatedDuration)}</span>` : ''}
      <span class="tag">🤖 ${esc(rm.model || 'AI')}</span>
      ${rm.mcpUsed ? `<span class="tag">⚡ superpowers methodology</span>` : ''}
      ${rm.review?.approved ? `<span class="tag tag-approved">🛡️ approved · ${esc(rm.review.score)}/10</span>` : ''}
      ${reviewBadges(rm)}
      ${srcTag}
      <span class="tag">🗓 ${fmtDate(rm.createdAt)}</span>
    </div>
    <div class="progress-panel">
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="progress-label">${done}/${total} steps · ${pct}%</span>
    </div>
  </div>

  ${principles ? `<h2 class="rm-section-title">Principles</h2><div class="principles">${principles}</div>` : ''}
  ${rm.milestoneProject ? `<h2 class="rm-section-title">Milestone project</h2>
    <div class="milestone"><span class="m-icon">🏆</span><div><b>Prove it works</b><p>${esc(rm.milestoneProject)}</p></div></div>` : ''}
  <h2 class="rm-section-title">The roadmap</h2>
  <div class="timeline">${timeline}</div>
  ${!phases.length ? '<p style="color:var(--text-dim)">This roadmap has no phases yet.</p>' : ''}`;
}

function bindRoadmap(rm, root) {
  $$('.step', root).forEach((el) => {
    el.addEventListener('click', async () => {
      const stepId = el.dataset.step;
      const nowDone = !el.classList.contains('done');
      el.classList.toggle('done', nowDone);
      rm.progress = rm.progress || {};
      rm.progress[stepId] = nowDone;
      if (!nowDone) delete rm.progress[stepId];
      try {
        await api(`/api/roadmaps/${rm.id}`, { method: 'PATCH', body: { progress: { [stepId]: nowDone } } });
        refreshProgressUi(rm, root);
      } catch (e) {
        el.classList.toggle('done', !nowDone);
        toast('Could not save progress: ' + e.message, 'err');
      }
    });
  });

  $('#btnMd', root)?.addEventListener('click', () => exportMd(rm));
  $('#btnJson', root)?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(rm, null, 2));
    toast('JSON copied to clipboard');
  });
  $('#btnRmDel', root)?.addEventListener('click', async () => {
    if (!confirm('Delete this roadmap forever?')) return;
    await api(`/api/roadmaps/${rm.id}`, { method: 'DELETE' });
    toast('Roadmap deleted');
    location.hash = '#/';
  });
}

function refreshProgressUi(rm, root) {
  const phases = rm.phases || [];
  let total = 0, done = 0;
  for (const p of phases) for (const s of p.steps || []) { total++; if (rm.progress?.[s.id]) done++; }
  const pct = total ? Math.round((done / total) * 100) : 0;
  const label = $('.progress-label', root);
  const fill = $('.progress-fill', root);
  if (label) label.textContent = `${done}/${total} steps · ${pct}%`;
  if (fill) fill.style.width = pct + '%';
  phases.forEach((p, i) => {
    const nodes = $$('.phase', root);
    const node = nodes[i];
    if (!node) return;
    const pDone = (p.steps || []).filter((s) => rm.progress?.[s.id]).length;
    const complete = (p.steps || []).length > 0 && pDone === (p.steps || []).length;
    node.classList.toggle('complete', complete);
    const nd = $('.phase-node', node);
    if (nd) nd.textContent = complete ? '✓' : String(i + 1);
  });
}

function exportMd(rm) {
  const lines = [];
  lines.push(`# ${rm.emoji || '🗺️'} ${rm.title}`, '');
  if (rm.summary) lines.push(`> ${rm.summary}`, '');
  lines.push(`**Difficulty:** ${rm.difficulty || '—'} · **Duration:** ${rm.estimatedDuration || '—'} · **Model:** ${rm.model || '—'}`, '');
  if (rm.source?.type === 'link') lines.push(`**Source:** [${rm.source.value}](${rm.source.value})`, '');
  if (rm.review) lines.push(`**Review:** ${rm.review.approved ? 'approved' : 'with notes'} · ${rm.review.score}/10`, '');
  if (rm.principles?.length) {
    lines.push('## Principles', '');
    rm.principles.forEach((p) => lines.push(`- ${p}`));
    lines.push('');
  }
  if (rm.milestoneProject) lines.push('## 🏆 Milestone project', '', rm.milestoneProject, '');
  lines.push('## Roadmap', '');
  rm.phases.forEach((p, i) => {
    lines.push(`### Phase ${i + 1}: ${p.title} ${p.duration ? `(${p.duration})` : ''}`, '');
    if (p.goal) lines.push(`*Goal: ${p.goal}*`, '');
    if (p.miniProject) lines.push(`**🛠️ Mini project:** ${p.miniProject}`, '');
    if (p.checklist?.length) {
      lines.push('**✅ Checkpoints:**');
      p.checklist.forEach((c) => lines.push(`- ${c}`));
      lines.push('');
    }
    p.steps.forEach((s) => {
      lines.push(`- [${rm.progress?.[s.id] ? 'x' : ' '}] **${s.title}**${s.hours ? ` (~${s.hours}h)` : ''}`);
      if (s.detail) lines.push(`  ${s.detail}`);
      if (s.verify) lines.push(`  - ✓ *Self-check:* ${s.verify}`);
      (s.resources || []).forEach((r) => lines.push(`  - [${r.label}](${r.url})`));
    });
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (rm.title || 'roadmap').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Markdown exported');
}

/* ------------------------------------------------ settings */

const settingsModal = $('#settingsModal');
const mcpStatusEl = $('#mcpStatus');

function openSettings() {
  api('/api/settings').then((s) => {
    $('#setBase').value = s.baseUrl || '';
    $('#setModel').value = s.model || '';
    $('#setMethodology').value = s.methodologySource || 'auto';
    $('#setSuperpowersPath').value = s.superpowersPath || '';
    $('#setBudget').value = s.callCharBudget || 24000;
    $('#setMcpUrl').value = s.mcpUrl || '';
    $('#setComposioUrl').value = s.composioUrl || '';
    $('#setComposioKey').value = '';
    $('#setKey').value = '';
    $('#keyHint').textContent = s.hasKey ? `✅ Saved: ${s.apiKeyPreview || '(hidden)'} — naya daalo to replace hoga` : '';
    $('#keyHint').classList.toggle('hint-ok', Boolean(s.hasKey));
    $('#composioHint').textContent = s.hasComposioKey
      ? `✅ Saved: ${s.composioKeyPreview || '(hidden)'} — Composio scraping active`
      : 'Not set — Researcher will use native fetch.';
    $('#composioHint').classList.toggle('hint-ok', Boolean(s.hasComposioKey));
    mcpStatusEl.textContent = '';
    settingsModal.classList.remove('hidden');
    $('#setBase').focus();
  }).catch((e) => toast(e.message, 'err'));
}

function closeSettings() { settingsModal.classList.add('hidden'); }

$('#btnSettings').addEventListener('click', openSettings);
$('#settingsClose').addEventListener('click', closeSettings);
$('#settingsCancel').addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) closeSettings(); });

$('#settingsSave').addEventListener('click', async () => {
  try {
    await api('/api/settings', {
      method: 'POST',
      body: {
        baseUrl: $('#setBase').value.trim(),
        apiKey: $('#setKey').value.trim(),
        model: $('#setModel').value.trim(),
        methodologySource: $('#setMethodology').value,
        superpowersPath: $('#setSuperpowersPath').value.trim(),
        callCharBudget: Number($('#setBudget').value) || 24000,
        mcpUrl: $('#setMcpUrl').value.trim(),
        composioUrl: $('#setComposioUrl').value.trim(),
        composioToken: $('#setComposioKey').value.trim(),
      },
    });
    toast('Settings saved');
    closeSettings();
  } catch (e) { toast(e.message, 'err'); }
});

function methodologyStatusLine(st, requested) {
  const ms = st.methodology || {};
  const counts = [
    ['brainstorming', 'brainstorming'],
    ['writingPlans', 'writing-plans'],
    ['usingSuperpowers', 'using-superpowers'],
  ].filter(([k]) => ms.skills && ms.skills[k] != null)
    .map(([k, label]) => `${label} ${Number(ms.skills[k]).toLocaleString()}`)
    .join(' · ');
  const chars = Number(ms.totalChars || 0).toLocaleString();
  if (ms.source === 'off' && !ms.error) return '⚠️ Methodology off';
  if (ms.ok && ms.source === 'local') return `✅ Local skills — ${chars} chars (${counts})`;
  if (ms.ok && ms.source === 'mcp') {
    return (requested === 'auto' || requested === 'local')
      ? `⚠️ Local skills not found — MCP: ${st.superpowers?.serverName || 'MCP'}`
      : `✅ MCP skills — ${chars} chars (${counts})`;
  }
  const where = ms.path ? ` at ${ms.path}` : '';
  return `⚠️ Methodology${where}: ${ms.error || 'no source resolved — choose a source in Settings'}`;
}

$('#btnMcpTest').addEventListener('click', async () => {
  mcpStatusEl.className = 'mcp-status';
  mcpStatusEl.textContent = 'Testing systems…';
  try {
    const requested = $('#setMethodology').value;
    await api('/api/settings', {
      method: 'POST',
      body: {
        baseUrl: $('#setBase').value.trim(),
        model: $('#setModel').value.trim(),
        methodologySource: requested,
        mcpUrl: $('#setMcpUrl').value.trim(),
        composioUrl: $('#setComposioUrl').value.trim(),
      },
    });
    const st = await api('/api/systems/status');
    const ms = st.methodology || {};
    const lines = [];
    lines.push(st.ai.ok ? '✅ AI ready' : '⚠️ AI: add API key');
    lines.push(st.superpowers.ok ? `✅ Superpowers MCP — ${st.superpowers.toolCount} skills` : `⚠️ Superpowers: ${st.superpowers.error}`);
    lines.push(st.composio.ok ? `✅ Composio MCP — ${st.composio.toolCount} tools` : `ℹ️ Composio: ${st.composio.error}`);
    lines.push(methodologyStatusLine(st, requested));
    // A deliberate "off" choice is valid; only a real methodology failure is an error.
    const methodologyOk = ms.ok === true || (ms.source === 'off' && !ms.error);
    const allOk = st.ai.ok && st.superpowers.ok && methodologyOk;
    mcpStatusEl.className = 'mcp-status ' + (allOk ? 'ok' : 'err');
    mcpStatusEl.innerHTML = lines.map(esc).join('<br>');
  } catch (e) {
    mcpStatusEl.className = 'mcp-status err';
    mcpStatusEl.textContent = `⚠️ ${e.message}`;
  }
});

/* ------------------------------------------------ boot */

bindDrawer();
route();
loadLibrary();
