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
