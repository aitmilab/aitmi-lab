import test from "node:test";
import assert from "node:assert/strict";
import { createChatGPTLabFlow } from "../src/chatgpt.mjs";

function setup(scope = "chatgpt.tokens.use.direct", extra = {}) {
  let url;
  const stored = [];
  let exchanges = 0;
  const flow = createChatGPTLabFlow({ hostId: "urn:uuid:12345678-1234-4234-8234-123456789012", redirectUri: "http://127.0.0.1:3456/callback",
    openBrowser: async (value) => { url = new URL(value); }, exchange: async () => { exchanges++; return { id_token: "private-id", access_token: "private-token", token_type: "Bearer", scope }; },
    verifyIdentity: async () => ({ sub: "private-subject" }), credentials: { clientId: async () => null, store: async (value) => stored.push(value), remove: async () => stored.splice(0) }, ...extra });
  return { flow, stored, exchanges: () => exchanges, callback: (state = url.searchParams.get("state")) => `http://127.0.0.1:3456/callback?code=private-code&client_id=oaiapp_lab&state=${state}`, url: () => url };
}
test("PKCE sign-in keeps callback, identity and tokens in the trusted host", async () => {
  const s = setup(); await s.flow.begin();
  assert.equal(s.url().searchParams.get("code_challenge_method"), "S256");
  assert.equal(s.url().searchParams.get("client_id"), "dynamic_agent_client");
  assert.deepEqual(await s.flow.complete(s.callback()), { ok: true });
  assert.deepEqual(s.flow.status(), { provider: "chatgpt", state: "connected" });
  assert.equal(s.stored.length, 1);
  assert.deepEqual(await s.flow.complete(s.callback()), { ok: false });
  assert.equal(s.exchanges(), 1);
  await s.flow.disconnect(); assert.equal(s.stored.length, 0);
});
test("wrong state, origin and duplicate parameters never exchange a code", async () => {
  const s = setup(); await s.flow.begin();
  for (const callback of [s.callback("wrong"), s.callback().replace("127.0.0.1", "evil.example"), s.callback() + "&code=second"]) assert.deepEqual(await s.flow.complete(callback), { ok: false });
  assert.equal(s.exchanges(), 0);
});
test("identity alone cannot activate plan usage", async () => {
  const s = setup("openid email"); await s.flow.begin();
  assert.deepEqual(await s.flow.complete(s.callback()), { ok: false });
  assert.deepEqual(s.flow.status(), { provider: "chatgpt", state: "limited" });
  assert.equal(s.stored.length, 0);
});
test("expired attempt and failed identity verification do not store tokens", async () => {
  let now = 0;
  const s = setup(undefined, { now: () => now }); await s.flow.begin(); now = 300001;
  assert.deepEqual(await s.flow.complete(s.callback()), { ok: false }); assert.equal(s.exchanges(), 0);
  const invalid = setup(undefined, { verifyIdentity: async () => { throw new Error("private provider details"); } });
  await invalid.flow.begin(); assert.deepEqual(await invalid.flow.complete(invalid.callback()), { ok: false }); assert.equal(invalid.stored.length, 0);
});
test("concurrent sign-in attempts cannot replace a pending PKCE state", async () => {
  const s = setup();
  const outcomes = await Promise.all([s.flow.begin(), s.flow.begin()]);
  assert.deepEqual(outcomes, [{ ok: true }, { ok: false }]);
  assert.equal(s.url().pathname, "/api/accounts/authorize");
});
test("returning registration rejects a changed client ID", async () => {
  const s = setup(undefined, { credentials: { clientId: async () => "oaiapp_previous", store: async () => { throw new Error("must not store"); }, remove: async () => {} } });
  await s.flow.begin();
  assert.equal(s.url().searchParams.has("agent_name_hint"), false);
  assert.deepEqual(await s.flow.complete(s.callback()), { ok: false }); assert.equal(s.exchanges(), 0);
});
test("disconnect during token exchange prevents late activation", async () => {
  let finish;
  const s = setup(undefined, { exchange: () => new Promise((resolve) => { finish = resolve; }) });
  await s.flow.begin(); const pending = s.flow.complete(s.callback());
  await s.flow.disconnect();
  finish({ id_token: "private", access_token: "private", token_type: "Bearer", scope: "chatgpt.tokens.use.direct" });
  assert.deepEqual(await pending, { ok: false }); assert.equal(s.stored.length, 0);
  assert.equal(s.flow.status().state, "revoked");
});
