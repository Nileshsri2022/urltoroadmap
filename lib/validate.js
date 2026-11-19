'use strict';

function normalizeTerm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function allCovers(roadmap) {
  const out = [];
  for (const p of roadmap.phases || []) {
    for (const c of p.covers || []) out.push(normalizeTerm(c));
    for (const s of p.steps || []) for (const c of s.covers || []) out.push(normalizeTerm(c));
  }
  return new Set(out);
}

function allPitfalls(roadmap) {
  const out = [];
  for (const p of roadmap.phases || []) {
    for (const s of p.steps || []) for (const c of s.addressesPitfalls || []) out.push(normalizeTerm(c));
  }
  return new Set(out);
}

function validateRoadmap(roadmap, research = {}) {
  const errors = [];
  const phases = Array.isArray(roadmap.phases) ? roadmap.phases : [];
  if (phases.length < 2) {
    errors.push({ code: 'too-few-phases', path: '$.phases', message: 'Roadmap needs at least two phases.' });
  }

  phases.forEach((p, pi) => {
    const pPath = `$.phases[${pi}]`;
    if (!String(p.goal || '').trim()) errors.push({ code: 'missing-goal', path: `${pPath}.goal`, message: 'Phase goal is required.' });
    if (!String(p.miniProject || '').trim()) errors.push({ code: 'missing-miniproject', path: `${pPath}.miniProject`, message: 'Phase miniProject is required.' });
    if (!Array.isArray(p.checklist) || p.checklist.length < 2) {
      errors.push({ code: 'bad-checklist', path: `${pPath}.checklist`, message: 'Phase needs at least two checklist items.' });
    }
    if (!Array.isArray(p.steps) || !p.steps.length) {
      errors.push({ code: 'empty-phase', path: `${pPath}.steps`, message: 'Phase needs at least one step.' });
    }
    (p.steps || []).forEach((s, si) => {
      const sPath = `${pPath}.steps[${si}]`;
      if (!String(s.title || '').trim()) errors.push({ code: 'missing-title', path: `${sPath}.title`, message: 'Step title is required.' });
      if (String(s.detail || '').trim().length < 120) {
        errors.push({ code: 'bad-detail', path: `${sPath}.detail`, message: 'Step detail must be at least 120 characters and concrete.' });
      }
      if (!Number.isFinite(Number(s.hours)) || Number(s.hours) <= 0) {
        errors.push({ code: 'bad-hours', path: `${sPath}.hours`, message: 'Step hours must be a positive number.' });
      }
      if (!String(s.verify || '').trim()) {
        errors.push({ code: 'bad-verify', path: `${sPath}.verify`, message: 'Step verify self-check is required.' });
      }
    });
  });

  const covered = allCovers(roadmap);
  const concepts = (research.keyConcepts || []).map((c) => String(c));
  const missingConcepts = concepts.filter((c) => !covered.has(normalizeTerm(c)));
  if (missingConcepts.length) {
    errors.push({ code: 'missing-concepts', path: '$.phases', message: 'Research concepts are not covered.', missing: missingConcepts });
  }

  const addressed = allPitfalls(roadmap);
  const pitfalls = (research.pitfalls || []).map((p) => String(p));
  const missingPitfalls = pitfalls.filter((p) => !addressed.has(normalizeTerm(p)));
  if (missingPitfalls.length) {
    errors.push({ code: 'missing-pitfalls', path: '$.phases', message: 'Research pitfalls are not addressed.', missing: missingPitfalls });
  }

  return {
    valid: errors.length === 0,
    errors,
    coverage: {
      concepts: { total: concepts.length, covered: concepts.length - missingConcepts.length, missing: missingConcepts },
      pitfalls: { total: pitfalls.length, covered: pitfalls.length - missingPitfalls.length, missing: missingPitfalls },
    },
  };
}

module.exports = { normalizeTerm, validateRoadmap };
