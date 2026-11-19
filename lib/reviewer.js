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
