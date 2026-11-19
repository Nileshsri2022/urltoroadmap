// OpenAI-compatible chat-completions client + robust JSON extraction.
'use strict';

const TIMEOUT_MS = 240000;

// Users paste various shapes: bare host, .../v1, or a full .../chat/completions.
function completionsUrl(base) {
  let b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('Base URL is empty');
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/v\d+$/.test(b)) return b + '/chat/completions';
  return b + '/v1/chat/completions';
}

async function chat(settings, messages, { json = true, temperature = 0.4 } = {}) {
  const url = completionsUrl(settings.baseUrl);
  const body = {
    model: settings.model,
    messages,
    temperature,
    stream: false,
  };
  if (json) body.response_format = { type: 'json_object' };

  const attempt = async (useJson) => {
    const payload = { ...body };
    if (!useJson) delete payload.response_format;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(safeError(text, res.status));
        err.statusCode = res.status;
        err.body = text.slice(0, 2000);
        throw err;
      }
      const data = JSON.parse(text);
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Model returned an empty response');
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await withRateLimitRetry(attempt, json);
  } catch (e) {
    // Some compatible servers reject response_format — retry once without it.
    const mentionsJson = /response_format|json_object|json_object/i.test(e.body || e.message || '');
    if (json && mentionsJson) return await withRateLimitRetry(attempt, false);
    throw e;
  }
}

// Free tiers hit tokens-per-minute limits on large prompts — back off and retry.
async function withRateLimitRetry(attempt, json) {
  const MAX_TRIES = 4;
  for (let i = 1; ; i++) {
    try {
      return await attempt(json);
    } catch (e) {
      const rateLimited = e.statusCode === 429 || /rate limit|tpm|rpm|too many requests|quota/i.test(e.message || '');
      if (!rateLimited || i >= MAX_TRIES) throw e;
      const waitSec = 20 * i; // 20s, 40s, 60s
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
}

function safeError(text, status) {
  try {
    const j = JSON.parse(text);
    return j.error?.message || j.message || `HTTP ${status}`;
  } catch {
    return text ? text.slice(0, 300) : `HTTP ${status}`;
  }
}

// Pull a JSON object out of an LLM reply (handles ```fences, prose, trailing commas).
function extractJson(text) {
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in model output');
  let candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // Common fix: trailing commas before } or ]
    const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(fixed);
  }
}

module.exports = { chat, extractJson, completionsUrl };
