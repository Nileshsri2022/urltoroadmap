# 🗺️ RoadmapForge

Paste any link or topic — get a **complete, phased learning roadmap**, built behind the scenes by a small agent team:

1. **Link extraction** — page content is fetched and cleaned locally (treated strictly as untrusted reference data).
2. **Methodology** — full [Superpowers](https://github.com/obra/superpowers) skills (brainstorming + writing-plans + using-superpowers), read from a local skills folder or the Superpowers MCP server. The full text is used — never truncated.
3. **Any OpenAI-compatible AI** — your base URL + API key + model ID drives the planning, with validation and targeted repair.
4. **Saved forever** — every roadmap is stored in `data/roadmaps/` with step-by-step progress tracking.

Zero npm dependencies. Runs on plain Node.js (≥18). There are no fixed phase, step, or question caps: the agents size the plan to the source.

## Run it

```bash
cd roadmap-forge
npm start          # → http://127.0.0.1:8787
```

1. Open **http://127.0.0.1:8787** and click **Settings**.
2. Set **Base URL**, **API key** and **Model ID** (OpenAI, Groq, OpenRouter, Together, LM Studio `http://localhost:11434/v1`, Ollama, …).
3. Choose **Methodology source**: `auto` (default — local skills if found, otherwise MCP), `local` (local skills only; fails loudly if missing), `mcp` (MCP server only), or `off` (plan without a methodology).
   - **Superpowers skills folder** overrides auto-detection; leave it empty to detect `~/.config/opencode/skills`. The `SUPERPOWERS_PATH` environment variable overrides both.
   - **Prompt budget per call (characters)** (`callCharBudget`, default `24000`) sets each prompt chunk. Full skill text is split across calls, never cut — raise the budget only for models with a higher TPM limit, lower it for smaller models.
   - Optional Composio API token enables Researcher **Web Scraping & Browser** tools for JS-rendered pages; without it, native `fetch` is used. Hit **Test MCP** to see resolved AI / MCP / Composio / methodology status with real skill character counts.
4. Paste a link (`https://doc.rust-lang.org/book/`) or a topic → **Forge roadmap**.
5. Follow the flow in the **agent drawer**: **Researcher** → **Interviewer** (a few questions — refreshing mid-interview resumes the same question) → approve the **playback** summary or ask for changes → pick an **approach** → **Planner outline** → per-phase expansion → **Reviewer**. Tabs: Orchestrator, Researcher, Interviewer, Planner, Reviewer — each shows the live activity feed and the full raw artifacts.
6. Your roadmap opens when the run is published — check off steps, export Markdown, copy JSON. Everything is saved.

The Planner writes an **outline first**, then expands phases one at a time — no fixed phase count, no step cap and no hidden truncation. The Reviewer checks that every research concept and pitfall is covered, plus step detail/hours/self-checks and phase checklists. If validation still fails after targeted repair, the roadmap is published with a **Draft — incomplete** tag and a `Coverage: concepts C/T · pitfalls C/T` line rather than being silently trimmed.

No API key yet? Click **Load demo roadmap** on the empty library to see the full experience.

## Files

| Path | What |
|---|---|
| `server.js` | HTTP server, REST API, SSE generation pipeline |
| `lib/mcp.js` | Minimal MCP streamable-HTTP client (Superpowers skills) |
| `lib/skills.js` | Local skill discovery + methodology loading (full text, never truncated) |
| `lib/agents.js` | Interview → playback → approach → plan → review orchestrator |
| `lib/validate.js` | Coverage + detail validation (drives repair and the Draft tag) |
| `lib/llm.js` | OpenAI-compatible chat-completions client + JSON repair |
| `lib/extract.js` | URL → clean text extraction |
| `lib/store.js` | Settings + roadmap + run JSON storage |
| `public/` | The whole UI — vanilla HTML/CSS/JS, including the agent drawer |
| `data/` | Your settings + saved roadmaps/runs (created at runtime) |

## API

| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/settings` | Read (keys masked) / save AI, MCP, Composio and methodology settings |
| GET | `/api/mcp/status` | Probe the Superpowers MCP server |
| GET | `/api/systems/status` | AI / MCP / Composio / methodology status (resolved source, path and skill char counts) |
| POST | `/api/brainstorm/start` | Start an interview run |
| POST | `/api/runs/:id/answer` / `confirm` / `approach` | Answer a question / approve playback / choose an approach |
| POST | `/api/generate/:id` | SSE pipeline: research → plan → validate → review → save |
| POST | `/api/generate` | Legacy one-shot SSE pipeline from a plain `input` string |
| GET | `/api/runs/:id` | Read a run's status and artifacts |
| GET | `/api/roadmaps` | List saved roadmaps |
| GET/DELETE/PATCH | `/api/roadmaps/:id` | Read / delete / update step progress |
| POST | `/api/demo` | Seed a demo roadmap |

## Notes

- Page content fetched from links is treated strictly as **untrusted data** — reference material for the AI only, never executed or injected raw into the UI.
- Settings keys: `methodologySource` (`auto` | `local` | `mcp` | `off`), `superpowersPath`, `callCharBudget` (default `24000`). `SUPERPOWERS_PATH` overrides the folder. API keys are masked in every GET response; legacy `useMcp: false` patches still map to `off`.
- Methodology is resolved once per run: local skills are read in full (path and char counts reported in `/api/systems/status`), and MCP is used when selected or when local is unavailable in `auto`. A resolved-but-broken local install is reported, never silently replaced.
- Runs are resumable: refreshing mid-interview resumes the same question; refreshing while a run is `generating` polls the existing run instead of starting a duplicate generation.
- Old saved roadmaps/runs (without `review.validation`) keep loading and rendering unchanged.
- Run the full test suite with `npm test` — zero dependencies, Node ≥18, Windows-friendly.
