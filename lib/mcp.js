// Minimal MCP (streamable HTTP) client for the Superpowers skill server.
'use strict';

const DEFAULT_MCP_URL = 'https://mcp.skillsovermcp.com/mcp/obra/superpowers';
const TIMEOUT_MS = 45000;

// One JSON-RPC POST. Response is SSE ("data: {...}") or plain JSON — handle both.
async function rpc(url, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
    const raw = await res.text();
    return parseResponse(raw);
  } finally {
    clearTimeout(timer);
  }
}

function parseResponse(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  // SSE: join all "data:" lines (JSON-RPC over streamable HTTP sends one message).
  const dataLines = trimmed.split(/\r?\n/).filter((l) => l.startsWith('data:'));
  if (!dataLines.length) throw new Error('MCP: empty response');
  const json = dataLines.map((l) => l.slice(5).trim()).join('\n');
  return JSON.parse(json);
}

function assertOk(msg) {
  if (msg.error) throw new Error(msg.error.message || 'MCP call failed');
  return msg;
}

// Full handshake + tools/call in one go (server is stateless, so keep it simple).
async function callTool(url, name, args = {}) {
  const endpoint = url || DEFAULT_MCP_URL;
  await rpc(endpoint, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'roadmap-forge', version: '1.0.0' },
    },
  });
  // Fire-and-forget notification; stateless servers ignore it either way.
  rpc(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
  const msg = assertOk(await rpc(endpoint, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name, arguments: args },
  }));
  const parts = (msg.result && msg.result.content) || [];
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return text;
}

// Fetch the Superpowers methodology used to shape roadmaps.
async function getMethodogy(url) {
  const [brainstorm, writingPlans] = await Promise.allSettled([
    callTool(url, 'skill_brainstorming', {}),
    callTool(url, 'skill_writing_plans', {}),
  ]);
  const sections = [];
  if (brainstorm.status === 'fulfilled' && brainstorm.value) {
    sections.push('### Superpowers skill: Brainstorming\n' + brainstorm.value);
  }
  if (writingPlans.status === 'fulfilled' && writingPlans.value) {
    sections.push('### Superpowers skill: Writing Plans\n' + writingPlans.value);
  }
  if (!sections.length) throw new Error('MCP returned no methodology content');
  return sections.join('\n\n');
}

async function status(url) {
  const endpoint = url || DEFAULT_MCP_URL;
  const init = await rpc(endpoint, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'roadmap-forge', version: '1.0.0' },
    },
  });
  const serverName = init.result?.serverInfo?.name || 'unknown';
  const list = assertOk(await rpc(endpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  return { serverName, tools: (list.result?.tools || []).map((t) => t.name) };
}

module.exports = { callTool, getMethodogy, status, DEFAULT_MCP_URL };
