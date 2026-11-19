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

test('nextQuestion stops instead of re-asking a substantially repeated question', async () => {
  const answers = [
    { q: 'Which specific AI domain or type of project would you like to focus on for your portfolio?', a: 'yes' },
    { q: 'Which specific AI domain or project type would you like to build for your portfolio?', a: 'yes' },
  ];
  let calls = 0;
  const deps = { chatJson: async () => {
    calls++;
    return { done: false, question: 'Which specific AI project or domain would you like to focus on for your portfolio-building plan?' };
  } };
  const out = await interview.nextQuestion({}, { input: 'ai engineer', research: {}, answers, methodology }, deps);
  assert.equal(out.done, true);
  assert.equal(out.question, undefined);
  assert.equal(calls, 1);
});

test('nextQuestion catches a re-asked question padded with parenthetical examples', async () => {
  const answers = [
    { q: 'Which specific AI domain or type of project (e.g., NLP chatbot, computer vision application, recommendation system, etc.) would you like to focus on for the portfolio-building project?', a: 'yes' },
  ];
  const deps = { chatJson: async () => ({
    done: false,
    question: 'Which specific AI project or domain would you like to focus on for your portfolio-building project?',
  }) };
  const out = await interview.nextQuestion({}, { input: 'ai engineer', research: {}, answers, methodology }, deps);
  assert.equal(out.done, true, 'examples must not mask an otherwise identical question');
});

test('nextQuestion prompt tells the model to treat non-committal answers as delegation and never re-ask', async () => {
  let seen = '';
  const deps = { chatJson: async (_s, system) => { seen = system; return { done: true }; } };
  await interview.nextQuestion({}, { input: 'rust', research: {}, answers: [{ q: 'Which domain?', a: 'yes' }], methodology }, deps);
  assert.ok(seen.includes('non-committal'), 'prompt must define non-committal answers');
  assert.ok(/re-ask|repeat/i.test(seen), 'prompt must forbid re-asking earlier questions');
});

test('nextQuestion still returns a genuinely new question', async () => {
  const answers = [{ q: 'What format do you want?', a: 'project plan' }];
  const deps = { chatJson: async () => ({ done: false, question: 'How many hours per week can you dedicate?' }) };
  const out = await interview.nextQuestion({}, { input: 'rust', research: {}, answers, methodology }, deps);
  assert.equal(out.done, false);
  assert.equal(out.question, 'How many hours per week can you dedicate?');
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
