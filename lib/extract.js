// Turn a pasted URL into clean text the LLM can learn from.
'use strict';

const TIMEOUT_MS = 30000;
const MAX_TEXT = 6000;

function isUrl(s) {
  return /^https?:\/\/\S+$/i.test(String(s || '').trim());
}

async function fetchSource(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RoadmapForge/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Failed to fetch link (HTTP ${res.status})`);
  const raw = await res.text();

  const ctype = res.headers.get('content-type') || '';
  if (/html/i.test(ctype) || /<html|<!doctype/i.test(raw)) {
    return extractHtml(raw, url);
  }
  // JSON / plain text — hand over a slice.
  return { title: hostOf(url), description: '', text: raw.slice(0, MAX_TEXT) };
}

function extractHtml(html, url) {
  const title = decode(match(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || match(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || '');
  const description = decode(
    match(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    match(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) || ''
  );

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  body = body
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  body = decode(body)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_TEXT);

  return { title: title || hostOf(url), description, text: body };
}

function match(s, re) {
  const m = s.match(re);
  return m ? m[1].trim() : null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", mdash: '—', ndash: '–', hellip: '…' };
function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z0-9]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] || m);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// ---------------------------------------------------------------- Apify fallback
// For JS-rendered (SPA) pages the raw HTML is thin. Apify's web-fetch MCP tool
// renders the page in a real browser and hands back clean markdown.

const APIFY_MCP = 'https://mcp.apify.com';
const APIFY_TIMEOUT_MS = 60000;
const THIN_CONTENT = 600; // chars of text below which we consider the page JS-rendered

function isThin(text) {
  return String(text || '').trim().length < THIN_CONTENT;
}

// One-shot MCP tools/call against mcp.apify.com (token goes in the URL query).
async function fetchViaApify(url, token) {
  if (!token) throw new Error('No Apify API token configured');
  const endpoint = `${APIFY_MCP}/?token=${encodeURIComponent(token)}`;

  const call = (payload) => new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), APIFY_TIMEOUT_MS);
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
      .then((r) => r.text())
      .then((raw) => {
        const t = raw.trim();
        let json;
        if (t.startsWith('{')) json = JSON.parse(t);
        else {
          const line = t.split(/\r?\n/).find((l) => l.startsWith('data:'));
          json = JSON.parse(line.slice(5).trim());
        }
        if (json.error) return reject(new Error(json.error.message || 'Apify MCP error'));
        resolve(json);
      })
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });

  await call({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'roadmap-forge', version: '1.0.0' },
    },
  });
  call({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});

  const res = await call({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: {
      name: 'apify--web-fetch',
      arguments: {
        method: 'GET',
        path: '/',
        query: { url, formats: ['markdown'] },
      },
    },
  });

  const parts = (res.result && res.result.content) || [];
  const md = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  if (!md.trim()) throw new Error('Apify returned empty content');
  // Markdown → plain-ish text for the LLM (strip fences, images, link urls).
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_TEXT);
  return { title: hostOf(url), description: '', text, viaApify: true };
}

module.exports = { isUrl, fetchSource, fetchViaApify, isThin };
