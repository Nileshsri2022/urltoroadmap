'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { chatJson, chat, extractJson, completionsUrl } = require('../lib/llm');

const settings = { model: 'test-model' };

function assertProviderError(err) {
  assert.ok(err instanceof Error, `expected an Error, got ${typeof err}: ${err}`);
  const msg = String(err.message);
  assert.match(msg, /^\[chatJson\]/, msg);
  assert.match(msg, /model setting/i, msg);
  assert.match(msg, /callCharBudget/i, msg);
  assert.ok(!msg.includes('undefined'), msg);
  return msg;
}

test('chatJson: provider error rejects once with stage, limit, detail and setting pointer', async () => {
  let calls = 0;
  const deps = { chat: async () => { calls++; throw new Error('Rate limit reached, Limit 8000'); } };
  await assert.rejects(
    () => chatJson(settings, 'sys', 'user', deps),
    (err) => {
      const msg = assertProviderError(err);
      assert.match(msg, /rate limit/i, msg);
      assert.match(msg, /Rate limit reached, Limit 8000/, msg);
      assert.equal(err.cause && err.cause.message, 'Rate limit reached, Limit 8000');
      return true;
    }
  );
  assert.equal(calls, 1, 'must not amplify the payload with a retry');
});

test('chatJson: parse failure does one honest JSON-format repair and returns parsed object', async () => {
  const seen = [];
  const expected = { ok: true, phases: [] };
  const deps = { chat: async (_s, messages) => {
    seen.push(messages);
    if (seen.length === 1) return 'not json at all';
    return JSON.stringify(expected);
  } };
  const out = await chatJson(settings, 'sys', 'user', deps);
  assert.deepEqual(out, expected);
  assert.equal(seen.length, 2, 'exactly one repair call');
  const repairUser = seen[1][seen[1].length - 1].content;
  assert.match(repairUser, /JSON/i, repairUser);
  assert.doesNotMatch(repairUser, /rate limit/i, repairUser);
  assert.match(repairUser, /corrected JSON object only/i, repairUser);
});

test('chatJson: a provider failure on the repair call surfaces a clear provider error', async () => {
  let calls = 0;
  const deps = { chat: async () => {
    calls++;
    if (calls === 1) return 'not json at all';
    throw new Error('Rate limit reached, Limit 8000');
  } };
  await assert.rejects(
    () => chatJson(settings, 'sys', 'user', deps),
    (err) => {
      const msg = assertProviderError(err);
      assert.match(msg, /rate limit/i, msg);
      assert.match(msg, /Rate limit reached, Limit 8000/, msg);
      return true;
    }
  );
  assert.equal(calls, 2);
});

test('chatJson: a non-Error thrown value never yields "undefined" in the message', async () => {
  const deps = { chat: async () => { throw 'quota exceeded'; } };
  await assert.rejects(
    () => chatJson(settings, 'sys', 'user', deps),
    (err) => {
      const msg = assertProviderError(err);
      assert.match(msg, /quota exceeded/, msg);
      return true;
    }
  );
});

test('chatJson: a non-limit provider failure is labelled a general provider failure', async () => {
  const deps = { chat: async () => { throw new Error('ECONNRESET'); } };
  await assert.rejects(
    () => chatJson(settings, 'sys', 'user', deps),
    (err) => {
      const msg = assertProviderError(err);
      assert.match(msg, /general provider failure/i, msg);
      assert.match(msg, /ECONNRESET/, msg);
      return true;
    }
  );
});

test('llm exports remain intact', () => {
  assert.equal(typeof chat, 'function');
  assert.equal(typeof chatJson, 'function');
  assert.equal(typeof extractJson, 'function');
  assert.equal(typeof completionsUrl, 'function');
});
