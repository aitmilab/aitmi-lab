import test from "node:test";
import assert from "node:assert/strict";
import { signInOpenRouter, checkOpenRouter } from "../src/openrouter-host.mjs";
import { checkChatGPT, signOutChatGPT, chatGPTSessionStatus } from "../src/chatgpt-session.mjs";

test("OpenRouter real callback binds state inside callback URL and exchanges only once", async () => {
  let stored; let count = 0; let sent; let callback;
  const status = await signInOpenRouter({ timeoutMs: 1000,
    credentials: { store: async (value) => { stored = value; }, remove: async () => {} },
    fetchImpl: async (url, options) => { count++; sent = { url, options }; return new Response(JSON.stringify({ key: "test-secret-key-marker" })); },
    openBrowser: async (value) => {
      const authorize = new URL(value); callback = new URL(authorize.searchParams.get("callback_url"));
      assert.equal(authorize.origin, "https://openrouter.ai");
      callback.searchParams.set("code", "test-code");
      const wrong = new URL(callback); wrong.searchParams.set("state", "wrong");
      assert.equal((await fetch(wrong)).status, 400); assert.equal(count, 0);
      assert.equal((await fetch(callback)).status, 200);
    } });
  assert.deepEqual(status, { provider: "openrouter", state: "connected" });
  assert.equal(stored.key, "test-secret-key-marker"); assert.equal(count, 1);
  assert.equal(sent.url, "https://openrouter.ai/api/v1/auth/keys");
  const body = JSON.parse(sent.options.body); assert.equal(body.code_challenge_method, "S256");
  assert.equal(body.code_verifier.length, 43); assert.equal(sent.options.redirect, "error");
  await assert.rejects(fetch(callback));
});

test("OpenRouter declined sign-in performs no exchange", async () => {
  let exchanged = false;
  const status = await signInOpenRouter({ timeoutMs: 1000, credentials: {}, fetchImpl: async () => { exchanged = true; },
    openBrowser: async (value) => { const callback = new URL(new URL(value).searchParams.get("callback_url")); callback.searchParams.set("error", "access_denied"); assert.equal((await fetch(callback)).status, 400); } });
  assert.equal(status.state, "unavailable"); assert.equal(exchanged, false);
});

test("OpenRouter account check projects no key, account, usage or provider error", async () => {
  const credentials = { read: async () => ({ key: "test-private" }) };
  assert.deepEqual(await checkOpenRouter(credentials, async () => new Response(JSON.stringify({ data: { label: "private", usage: 5 } }))), { provider: "openrouter", state: "connected" });
  assert.equal((await checkOpenRouter(credentials, async () => new Response("private", { status: 401 }))).state, "expired");
  assert.equal((await checkOpenRouter(credentials, async () => { throw new Error("private"); })).state, "unavailable");
});

test("ChatGPT refresh retains issued client, rotates credentials atomically and sends no scope", async () => {
  const old = { clientId: "oaiapp_test", subject: "test", savedAt: 0,
    tokens: { access_token: "old", refresh_token: "refresh-old", id_token: "id-old", scope: "chatgpt.tokens.use.direct resource.invoke", expires_in: 1 } };
  let stored; let sent;
  const status = await checkChatGPT({ read: async () => old, store: async (value) => { stored = value; } }, {
    now: () => 100000, fetchImpl: async (url, options) => { sent = { url, options }; return new Response(JSON.stringify({ access_token: "new", refresh_token: "refresh-new", token_type: "Bearer", expires_in: 3600 })); } });
  assert.equal(status.state, "connected"); assert.equal(stored.tokens.refresh_token, "refresh-new");
  const form = new URLSearchParams(sent.options.body);
  assert.equal(form.get("client_id"), "oaiapp_test"); assert.equal(form.has("scope"), false);
  assert.equal(stored.tokens.scope, old.tokens.scope); assert.equal(old.tokens.access_token, "old");
});

test("ChatGPT missing plan grant cannot be mistaken for connected", () => {
  assert.equal(chatGPTSessionStatus({ savedAt: Date.now(), tokens: { access_token: "test", scope: "openid", expires_in: 3600 } }).state, "limited");
  assert.equal(chatGPTSessionStatus({ savedAt: Date.now(), tokens: { access_token: "test", scope: "chatgpt.tokens.use.direct", expires_in: 3600 } }).state, "limited");
  assert.equal(chatGPTSessionStatus(null).state, "not-configured");
});

test("ChatGPT sign-out revokes only at discovered OpenAI destination then clears locally", async () => {
  const events = [];
  const status = await signOutChatGPT({ read: async () => ({ clientId: "oaiapp_test", tokens: { refresh_token: "test-refresh" } }), signOut: async () => { events.push("cleared"); } }, async (url, options) => {
    if (url.endsWith("openid-configuration")) return new Response(JSON.stringify({ issuer: "https://auth.openai.com", revocation_endpoint: "https://auth.openai.com/test-revoke" }));
    events.push("revoked"); assert.equal(new URLSearchParams(options.body).get("token_type_hint"), "refresh_token"); return new Response(null, { status: 200 });
  });
  assert.equal(status.remoteRevocationConfirmed, true); assert.deepEqual(events, ["revoked", "cleared"]);
});

test("ChatGPT hostile revocation URL never receives tokens; local sign-out remains truthful", async () => {
  let requests = 0; let cleared = false;
  const status = await signOutChatGPT({ read: async () => ({ clientId: "oaiapp_test", tokens: { refresh_token: "test-refresh" } }), signOut: async () => { cleared = true; } }, async () => {
    requests++; return new Response(JSON.stringify({ issuer: "https://auth.openai.com", revocation_endpoint: "https://evil.example/revoke" }));
  });
  assert.equal(requests, 1); assert.equal(cleared, true); assert.equal(status.remoteRevocationConfirmed, false);
});
