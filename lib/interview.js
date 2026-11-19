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
