'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeTerm, validateRoadmap } = require('../lib/validate');

const research = {
  keyConcepts: ['Ownership', 'Borrowing', 'Lifetimes'],
  pitfalls: ['Fighting the borrow checker too late'],
};

function roadmap(overrides = {}) {
  return {
    title: 'Rust',
    phases: [{
      id: 'p1', title: 'Foundations', goal: 'Own the basics',
      miniProject: 'Build a CLI', checklist: ['Can explain moves', 'Can explain borrows'],
      covers: ['Ownership', 'Borrowing'],
      steps: [{
        id: 'p1s1', title: 'Read chapter 4',
        detail: 'Read the ownership chapter and type every example yourself, then explain moves, clones and drops in your own words without looking back at the text.',
        hours: 4, verify: 'Explain move vs clone without notes',
        covers: ['Ownership'], addressesPitfalls: ['Fighting the borrow checker too late'],
        resources: [],
      }],
    }, {
      id: 'p2', title: 'Lifetimes', goal: 'Use lifetimes',
      miniProject: 'Build a parser', checklist: ['Can annotate a struct', 'Can explain elision rules'],
      covers: ['Lifetimes'],
      steps: [{
        id: 'p2s1', title: 'Annotate lifetimes',
        detail: 'Annotate three functions with explicit lifetimes, then remove each annotation one at a time and explain out loud why the compiler accepts or rejects it.',
        hours: 3, verify: 'Annotate a struct without compiler help',
        covers: ['Lifetimes'], addressesPitfalls: [], resources: [],
      }],
    }],
    ...overrides,
  };
}

test('normalizeTerm trims, lowercases, collapses whitespace', () => {
  assert.equal(normalizeTerm('  Fight   THE  Borrow '), 'fight the borrow');
});

test('validateRoadmap accepts a complete roadmap', () => {
  const res = validateRoadmap(roadmap(), research);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
  assert.equal(res.coverage.concepts.covered, 3);
  assert.equal(res.coverage.pitfalls.covered, 1);
});

test('validateRoadmap reports missing coverage with verbatim values', () => {
  const rm = roadmap();
  rm.phases[1].covers = [];
  rm.phases[1].steps[0].covers = [];
  const res = validateRoadmap(rm, research);
  assert.equal(res.valid, false);
  const err = res.errors.find((e) => e.code === 'missing-concepts');
  assert.deepEqual(err.missing, ['Lifetimes']);
});

test('validateRoadmap enforces detail, hours, verify and checklist', () => {
  const rm = roadmap();
  rm.phases[0].steps[0].detail = 'short';
  rm.phases[0].steps[0].hours = 0;
  rm.phases[0].steps[0].verify = '';
  rm.phases[0].checklist = ['one'];
  const codes = validateRoadmap(rm, research).errors.map((e) => e.code).sort();
  assert.deepEqual(codes, ['bad-checklist', 'bad-detail', 'bad-hours', 'bad-verify']);
});
