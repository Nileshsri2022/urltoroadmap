# RoadmapForge — Superpowers-driven interactive roadmap generation

Date: 2026-11-19
Status: Draft for approval

## Intent and why

RoadmapForge today is single-shot and shallow. The Planner receives a
5,000-character slice of two Superpowers skills (the real content is
~25,000 characters), no user context, and the saved roadmap silently
drops the fields that make it useful: of 22 generated steps, zero had a
`verify` self-check, zero had `hours`, zero phases had a `miniProject`
or `checklist`. The Reviewer scored the result 6/10 and rejected it, but
the roadmap was published anyway.

The goal is to make the app follow the actual Superpowers workflow with
the skills installed on the machine, and to let the user watch every
agent's full output.

## What the user asked for

- Roadmaps must be as detailed as the topic needs. No fixed phase/step
  counts, no artificial caps.
- Use the installed Superpowers skills, in full, and follow all their
  steps — not a truncated text blob.
- The AI must ask the user questions first; the answers shape the
  roadmap.
- Each agent's complete response must be visible in its own tab in a
  sidebar, like the live logs.

## Goals

1. Add an interactive brainstorm stage before generation: questions,
   playback, approach choice.
2. Load full Superpowers methodology from the local install; fall back
   to the configured MCP server. No silent truncation.
3. Size roadmaps by content, not by constants.
4. Enforce detail deterministically: schema validation plus targeted
   repair before publish.
5. Add an agent drawer with a tab per stage showing status, logs, full
   readable output, and raw JSON.

## Non-goals

- Multi-user accounts, auth, or cloud sync.
- A general agent runtime or arbitrary tool-use loops.
- Changing the storage format incompatibly; old roadmaps must keep
  loading.
- Reworking the existing visual design language.

## Anti-goals

- A roadmap that looks detailed but is padded with filler.
- Hard caps that truncate a genuinely large topic.
- Dumping raw JSON as the only view of an agent's output.
- Silent degradation when the local skills are missing.

## Constraints

- Zero npm dependencies; Node.js >= 18; Windows-friendly paths.
- Keep the existing SSE pipeline and hash router.
- Preserve the existing REST API for old clients where practical.

## Current state (evidence)

- `lib/mcp.js` calls `skill_brainstorming` (15,081 chars) and
  `skill_writing_plans` (10,190 chars), then truncates each to 2,500
  characters. The Planner receives 5,000 of ~25,000 characters.
- `lib/agents.js` injects that text as a methodology block. Nothing in
  the pipeline ever asks the user a question.
- The local install at `%USERPROFILE%\.config\opencode\skills` contains
  15 Superpowers skills and is unused by the app.
- Latest saved roadmap (`rm_mwnb1k3c_97af15cf`): 6 phases, 22 steps,
  0 `verify`, 0 `hours`, 0 `miniProject`, 0 `checklist`,
  `review.approved=false`, score 6/10, published anyway.
- Recent run failed on a Groq 8,000 TPM limit with a ~5k methodology +
  12k research prompt.

## Superpowers step mapping

Superpowers is a development workflow; RoadmapForge is a learning
roadmap generator. The mapping is explicit:

| Superpowers step | RoadmapForge stage |
|---|---|
| Brainstorming: ask one question at a time | Interviewer asks adaptive questions |
| Brainstorming: play back understanding | Playback card, user confirms/edits |
| Brainstorming: lay out approaches, user picks | Learning-approach cards (2-3), user picks |
| Brainstorming: written design | Design brief: goal, level, weekly time, success criteria, constraints |
| Writing plans: bite-sized verifiable steps | Roadmap phases/steps with `verify` and `hours` |
| Executing plans / progress | Existing per-step checkboxes and progress ring |
| Verification before completion | Step `verify` fields + Reviewer gate |

## The flow

0. **Intake** — user submits a link or topic. Researcher gathers source
   context (existing behavior; native fetch or Composio).
1. **Interview** — the Interviewer asks one question at a time, 3-6
   adaptive questions (goal, current level, time per week, learning
   preference, constraints, definition of done). User may skip or say
   "you decide". Transcript is saved.
2. **Playback** — the AI restates its understanding in 3-5 lines. The
   user confirms or edits.
3. **Approaches** — the AI proposes 2-3 learning approaches with
   tradeoffs (for example project-first vs theory-first vs
   interview-prep). The user picks one, or asks the AI to choose.
4. **Plan** — the Planner generates the roadmap using the full
   `writing-plans` methodology plus the interview, playback, chosen
   approach, and research report.
5. **Review** — deterministic validation, then the LLM Reviewer.
   Targeted repair passes (max 2). Publish approved, or publish as a
   clearly badged draft.
6. **Track** — existing progress checkboxes.

## Sizing without caps

The Planner decides how many phases and steps a topic needs. Guidance,
not limits:

- Do not merge unrelated milestones to save space; do not split one
  skill into busywork to look thorough.
- Every phase ends with something the learner can build or demonstrate.
- One step per concrete action; a step is never a list of unrelated
  actions.

Because one giant completion has an output limit on every provider, the
Planner works in two passes:

1. **Outline pass** — phase titles, goals, durations, and step titles
   only, sized by content.
2. **Expand pass** — one call per phase (or per two small phases) adds
   each step's `detail`, `hours`, `verify`, `resources`, `covers`,
   `addressesPitfalls`, plus the phase's `miniProject` and `checklist`.

A truncated or unparsable expand response is retried for that batch
only; it never discards the outline. There is no fixed phase or step
count anywhere in this flow.

## Prompt budget and call shape

- Skills are read once per run and cached in memory.
- Only the stage-relevant skill is injected: `brainstorming` for the
  Interviewer, `writing-plans` for outline and expand, no skill text for
  the Reviewer (it gets a rubric and the artifacts).
- `using-superpowers` is read and shown in the drawer, and used by the
  orchestrator to confirm stage order; it is not injected into content
  prompts.
- Full skill text is used; nothing is truncated silently. Total
  methodology is ~27,000 characters (`brainstorming` 13,602,
  `writing-plans` 10,335, `using-superpowers` 3,192).
- Every LLM call has a configurable payload budget (`callCharBudget`,
  default 24,000 characters). A stage whose payload exceeds the budget
  chunks itself: expand runs one phase per call, review runs two phases
  per call plus the outline for cross-phase checks.
- If the provider still rejects a request for size or rate limits, the
  run fails with a message naming the likely limit and pointing at the
  model setting. It never silently drops content.

## Quality gates (deterministic)

Coverage is a data contract, not an inference. The Planner receives the
exact `research.keyConcepts` and `research.pitfalls` strings and must
emit:

- `covers: [string]` on every phase and step — exact copies of
  `research.keyConcepts` values.
- `addressesPitfalls: [string]` on every step — exact copies of
  `research.pitfalls` values.

Validation runs after parsing and before the Reviewer:

- Every `keyConcept` appears in the union of phase and step `covers`.
- Every `pitfall` appears in the union of step `addressesPitfalls`.
- Each step: non-empty `title`, `detail` of at least 120 characters,
  positive `hours`, non-empty `verify`.
- Each phase: non-empty `goal`, `miniProject`, and at least two
  `checklist` items.
- At least two phases; dependency order is checked by the Reviewer.

Matching is deterministic: trim, lowercase, collapse whitespace, then
compare. No fuzzy matching. Missing values are listed verbatim in the
repair prompt.

On failure, the exact validation errors are sent back to the Planner
for a targeted repair (max 2 attempts per review round). If it still
fails, the Reviewer still runs once, the roadmap is saved with
`review.approved=false` and `review.validation` errors, and the UI shows
a "Draft — incomplete" badge. Work is never silently lost or silently
marked complete.

## Repair and review order

For each review round (max 2):

1. Plan (round 1) or revise from review feedback (round 2).
2. Expand any outstanding phases.
3. Validate. If invalid, targeted repair (max 2 attempts).
4. Reviewer runs and scores the roadmap.
5. Approved → publish. Rejected and round < 2 → next round.

Repairs are counted per round, not per run; `run.rounds` counts review
rounds and `run.repairs` counts repairs. Every published roadmap has a
Reviewer score, including drafts.

## Methodology source

- Primary: read `SKILL.md` files in full from the local Superpowers
  skills directory, configured as `superpowersPath` (Settings field;
  `SUPERPOWERS_PATH` environment variable overrides it). Auto-detect
  order: `%USERPROFILE%\.config\opencode\skills`, then the plugin cache
  path exposed by the installed package. Skills used: `brainstorming`,
  `writing-plans`, `using-superpowers`.
- Fallback: the configured MCP server, fetched in full (no 2,500-char
  truncation).
- New setting `methodologySource`: `auto` (default), `local`, `mcp`, or
  `off`. Backward compatibility: `useMcp: false` maps to `off`;
  `useMcp: true` maps to `auto` when `methodologySource` is absent.
- `off` disables methodology injection but still uses the built-in
  structural rules; the UI states which source is active.
- No silent truncation. If the local source resolves but a skill file is
  missing, the UI reports it; the app does not fall back silently.
- `/api/systems/status` reports the resolved source, path, and
  per-skill character counts.

## Agent drawer

A right-side drawer available during live generation and on the run
page. Collapsible; full-screen on narrow viewports.

Tabs: Orchestrator, Researcher, Interviewer, Planner, Reviewer. Each tab
shows:

- status and wall-clock duration (fix the never-set `startedAt` /
  `endedAt`),
- that stage's log lines,
- full readable output: research report sections, Q&A transcript and
  playback/approach choice, Planner draft(s), Reviewer checklist and
  issues,
- a "Raw JSON" toggle and a copy button.

During live generation, the existing `artifact` SSE event triggers a
fetch of `/api/runs/:id` and re-renders the drawer. Agent logs keep
streaming as they do now.

## API

- `POST /api/brainstorm/start` `{ input }` →
  `{ runId, stage: "questions", question, index }` (Researcher runs here).
- `POST /api/runs/:id/answer` `{ answer }` → next question, playback, or
  approaches; the pending question/state is persisted before replying.
- `POST /api/runs/:id/confirm` `{ action: "approve" | "edit", edits? }`.
- `POST /api/runs/:id/approach` `{ approachId | "auto" }` → then the
  client opens `POST /api/generate/:runId` for SSE generation.
- `GET /api/runs/:id` returns `stage`, `pendingQuestion`, `answers`, and
  artifacts, so the interview resumes after a refresh or navigation.
- New route `#/interview/:id` reopens an in-progress interview.
- Existing `/api/generate` runs one shared staged pipeline with the
  interview auto-skipped (neutral defaults, no approach choice). It still
  gets full methodology, validation, repair, and draft policy; there is
  no second frozen pipeline.

## Storage

Run additions (backward compatible): `stage`, `pendingQuestion`,
`questionIndex`, `answers[]`, `playback`, `approaches[]`,
`chosenApproach`, `validation`, `repairs`.

Roadmap additions: `covers` and `addressesPitfalls` arrays, and
`review.validation`.

## Files touched

- `lib/skills.js` (new) — locate and read local skills; MCP fallback.
- `lib/interview.js` (new) — question, playback, approach prompts and
  parsing.
- `lib/agents.js` — staged pipeline, full methodology, validation,
  repair, timings.
- `lib/mcp.js` — untruncated methodology fetch; keep `getMethodogy`
  alias for compatibility.
- `lib/store.js` — run stage/answers; `superpowersPath` setting.
- `server.js` — new routes; parse `runId` for generation.
- `public/index.html`, `public/app.js`, `public/style.css` — interview
  cards, drawer, tab rendering.
- `README.md` — document the new flow.

## Approaches considered

- **A. Drawer plus prompt tightening.** Small, but the roadmap stays
  single-shot and shallow, and missing fields remain possible. Rejected.
- **B. Strict schema with fixed 6-8 phases x 5-8 steps.** Guarantees
  some detail but caps the roadmap and truncates large topics. Rejected
  by the user.
- **C. Interactive Superpowers flow, content-sized.** Chosen: full
  local skills, AI asks questions, approaches, no caps, deterministic
  quality gates, agent drawer.

Decisions inside C:

- Question transport: plain JSON endpoints for the interview, then SSE
  for generation. One long-lived SSE connection across the whole
  interview was rejected as fragile.
- Local-first methodology with MCP fallback. Local-only was rejected
  because the app must still work on machines without the OpenCode
  install.
- Invalid-after-repair roadmaps publish as badged drafts rather than
  being blocked. Blocking was rejected because it throws away work.

## Calls made by the builder (not agreed with the user)

- 3-6 adaptive interview questions, with skip and "you decide".
- Drawer tabs include the new Interviewer and Orchestrator.
- Stage-scoped skill injection: `brainstorming` for the Interviewer,
  `writing-plans` for outline/expand, nothing for the Reviewer.
  `using-superpowers` is read and displayed but not prompt-injected.
- Outline pass then expand pass, with a `callCharBudget` of 24,000
  characters per LLM call; chunking instead of truncation.
- Coverage contract: exact-string `covers` on phases/steps and
  `addressesPitfalls` on steps, normalized comparison, verbatim missing
  values in repair prompts.
- Repair runs inside each review round (max 2 repairs per round); the
  Reviewer always runs, including for drafts.
- Interview state is persisted and resumable via `#/interview/:id`.
- `methodologySource` (`auto`/`local`/`mcp`/`off`) with `useMcp`
  mapping; `superpowersPath` setting plus `SUPERPOWERS_PATH` override.
- One shared pipeline: `/api/generate` auto-skips the interview but gets
  the new methodology, validation, repair, and draft policy.
- Detail threshold: 120 characters minimum per step.
- Publish-as-draft policy when repair still fails.
- Auto-detect order for the local skills path.

## Left to the builder

- Exact prompt wording and question copy.
- Drawer styling and responsive behavior.
- Test approach and fixtures.
- Migration details for existing run files.
- Exact per-phase batching when a phase's expanded payload exceeds the
  call budget.
