// Composio MCP client — Web Scraping & Browser tools for the Researcher agent.
// Server: https://connect.composio.dev/mcp (universal MCP gateway).
//
// The gateway exposes meta-tools; real scraping tools are discovered via
// COMPOSIO_SEARCH_TOOLS and executed via COMPOSIO_MULTI_EXECUTE_TOOL:
//   1. search "scrape a webpage with browser rendering" → primary_tool_slugs
//   2. execute that slug with { url } → markdown/text back
'use strict';

const DEFAULT_URL = 'https://connect.composio.dev/mcp';
const TIMEOUT_MS = 120000;
const SCRAPE_QUERY = 'scrape a webpage with browser rendering into markdown';

function headers(token) {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function rpc(url, token, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers: headers(token), body: JSON.stringify(payload), signal: ctrl.signal });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Composio HTTP ${res.status}: ${raw.slice(0, 200)}`);
    const t = raw.trim();
    if (t.startsWith('{')) return JSON.parse(t);
    const line = t.split(/\r?\n/).reverse().find((l) => l.startsWith('data:'));
    if (!line) throw new Error('Composio: empty response');
    return JSON.parse(line.slice(5).trim());
  } finally {
    clearTimeout(timer);
  }
}

const ok = (m) => { if (m.error) throw new Error(m.error.message || 'Composio call failed'); return m; };
const metaText = (m) => (((m.result || {}).content) || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');

async function handshake(url, token) {
  await rpc(url, token, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'roadmap-forge', version: '2.0.0' } },
  });
  rpc(url, token, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
}

// Parse the wrapped payload Composio returns inside the text content.
function unwrap(text) {
  try { return JSON.parse(text); } catch { return { successful: false, data: { error: String(text).slice(0, 300) } }; }
}

// Discover scraping tool slugs for a query.
async function searchToolSlugs(url, token, query) {
  await handshake(url, token);
  const m = ok(await rpc(url, token, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'COMPOSIO_SEARCH_TOOLS', arguments: { query, limit: 4 } },
  }));
  const body = unwrap(metaText(m));
  const results = body?.data?.results || [];
  const slugs = [];
  for (const r of results) {
    (r.primary_tool_slugs || []).forEach((s) => slugs.push(s));
    (r.related_tool_slugs || []).forEach((s) => slugs.push(s));
  }
  return slugs;
}

// Execute one tool through the meta executor.
async function execute(url, token, toolSlug, args) {
  const m = ok(await rpc(url, token, {
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: {
      name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
      arguments: { tools: [{ tool_slug: toolSlug, arguments: args }] },
    },
  }));
  const body = unwrap(metaText(m));
  if (body.successful === false) {
    throw new Error(body.data?.error || 'Composio execution failed');
  }
  const r0 = body?.data?.results?.[0];
  const resp = r0?.response || {};
  if (resp.successful === false) throw new Error(resp.data?.error || resp.error || 'Composio tool failed');
  return resp.data || resp || {};
}

// Best-effort: find the biggest text-ish field in a nested result.
function extractText(obj, depth = 0) {
  if (depth > 6 || obj == null) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return '';
  if (Array.isArray(obj)) {
    const parts = obj.map((v) => extractText(v, depth + 1)).filter(Boolean);
    return parts.sort((a, b) => b.length - a.length)[0] || '';
  }
  const preferred = ['markdown', 'content', 'text', 'html', 'body', 'description', 'result'];
  for (const key of preferred) {
    if (typeof obj[key] === 'string' && obj[key].trim()) return obj[key];
    if (obj[key] != null && typeof obj[key] === 'object') {
      const found = extractText(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return '';
}

// Scrape a URL via Composio's browser-rendering scraping toolkit.
// Returns { toolName, text }.
async function scrape(targetUrl, settings) {
  const url = settings.composioUrl || DEFAULT_URL;
  const token = settings.composioToken;
  if (!token) throw new Error('No Composio API token configured');

  const slugs = await searchToolSlugs(url, token, SCRAPE_QUERY);
  const slug = slugs.find((s) => /scrape|extract|fetch|browser/i.test(s)) || slugs[0];
  if (!slug) throw new Error('No scraping tool found in Composio for this query');

  const data = await execute(url, token, slug, { url: targetUrl });
  let text = extractText(data);
  // If the toolkit handed back HTML, strip tags crudely before handing to the LLM.
  if (/^\s*</.test(text) && /<html|<body|<div/i.test(text)) {
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n');
  }
  text = text.replace(/[#*_>`]+/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, 12000);
  if (!text) throw new Error(`Composio tool ${slug} returned no readable content`);
  return { toolName: slug, text };
}

async function status(url, token) {
  try {
    await handshake(url || DEFAULT_URL, token);
    const m = ok(await rpc(url || DEFAULT_URL, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const tools = (((m.result || {}).tools) || []).map((t) => t.name);
    return { ok: true, toolCount: tools.length, tools: tools.slice(0, 12) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { scrape, status, DEFAULT_URL };
