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
