# 🗺️ RoadmapForge

Paste any link or topic — get a **complete, phased learning roadmap**, built behind the scenes by:

1. **Link extraction** — the page content is fetched and cleaned locally
2. **[Superpowers MCP](https://mcp.skillsovermcp.com/mcp/obra/superpowers)** — the `skill_brainstorming` + `skill_writing_plans` methodologies shape the plan's structure
3. **Any OpenAI-compatible AI** — your own base URL + API key + model ID drafts the roadmap
4. **Saved forever** — every roadmap is stored in `data/roadmaps/` with step-by-step progress tracking

Zero npm dependencies. Runs on plain Node.js (≥18).

## Run it

```bash
cd roadmap-forge
npm start          # → http://127.0.0.1:8787
```

1. Open **http://127.0.0.1:8787**
2. Click **Settings** → fill **Base URL**, **API key**, **Model ID** (works with OpenAI, Groq, OpenRouter, Together, LM Studio, Ollama `http://localhost:11434/v1`, …) → Save. Optionally toggle the Superpowers MCP integration and hit **Test MCP**.
3. Paste any link (`https://doc.rust-lang.org/book/`) or topic (`learn computer graphics`) → **Forge roadmap**
4. Watch the live pipeline, then your roadmap opens — check off steps, export Markdown, copy JSON. Everything is saved.

No API key yet? Click **Load demo roadmap** on the empty library to see the full experience.

## Files

| Path | What |
|---|---|
| `server.js` | HTTP server, REST API, SSE generation pipeline |
| `lib/mcp.js` | Minimal MCP streamable-HTTP client (Superpowers skills) |
| `lib/llm.js` | OpenAI-compatible chat-completions client + JSON repair |
| `lib/extract.js` | URL → clean text extraction |
| `lib/store.js` | Settings + roadmap JSON storage |
| `public/` | The whole UI — vanilla HTML/CSS/JS |
| `data/` | Your settings + saved roadmaps (created at runtime) |

## API

| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/settings` | Read (key masked) / save AI + MCP settings |
| GET | `/api/mcp/status` | Probe the Superpowers MCP server |
| GET | `/api/roadmaps` | List saved roadmaps |
| GET/DELETE/PATCH | `/api/roadmaps/:id` | Read / delete / update step progress |
| POST | `/api/generate` | SSE pipeline: fetch → mcp → ai → save |
| POST | `/api/demo` | Seed a demo roadmap |

## Notes

- Page content fetched from links is treated strictly as **untrusted data** — it's only used as reference material for the AI, never executed or injected raw into the UI.
- Methodology via MCP is optional: if the server is unreachable, generation continues without it and the roadmap is marked accordingly.
