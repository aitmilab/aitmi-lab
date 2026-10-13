import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenAIIdentityAdapters, signInChatGPT } from "../src/chatgpt-host.mjs";
import { openWindowsCredentials } from "../src/windows-credentials.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims = {}, header = {}) => {
  const input = `${encode({ alg: "RS256", kid: "test", ...header })}.${encode({ iss: "https://auth.openai.com", sub: "test-account", aud: "oaiapp_test", nonce: "test-nonce", exp: 2000, ...claims })}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
};
const expected = { audience: "oaiapp_test", nonce: "test-nonce", issuer: "https://auth.openai.com" };

test("live adapter verifies signatures and refuses wrong issuer/audience/nonce/expiry/algorithm", async () => {
  const calls = [];
  const adapter = createOpenAIIdentityAdapters({ now: () => 1000000, fetchImpl: async (url, options) => {
    calls.push([url, options]); return new Response(JSON.stringify({ keys: [jwk] }));
  } });
  assert.deepEqual(await adapter.verifyIdentity(jwt(), expected), { sub: "test-account" });
  for (const claims of [{ iss: "https://evil.example" }, { aud: "wrong" }, { nonce: "wrong" }, { exp: 999 }, { nbf: 2000 }, { aud: ["oaiapp_test", "other"] }]) await assert.rejects(adapter.verifyIdentity(jwt(claims), expected));
  await assert.rejects(adapter.verifyIdentity(jwt({}, { alg: "none" }), expected));
  const tampered = jwt().split("."); tampered[1] = encode({ sub: "attacker" });
  await assert.rejects(adapter.verifyIdentity(tampered.join("."), expected));
  assert.ok(calls.every(([url, options]) => url === "https://auth.openai.com/.well-known/jwks.json" && options.redirect === "error"));
});

test("code exchange uses fixed endpoint/form and rejects provider failure without its body", async () => {
  let sent;
  const adapter = createOpenAIIdentityAdapters({ fetchImpl: async (url, options) => { sent = { url, options }; return new Response("private details", { status: 400 }); } });
  await assert.rejects(adapter.exchange({ code: "test-code", code_verifier: "test-verifier" }), /^Error: provider-request-failed$/);
  assert.equal(sent.url, "https://auth.openai.com/api/accounts/oauth/token");
  assert.equal(new URLSearchParams(sent.options.body).get("code_verifier"), "test-verifier");
});

test("real loopback listener rejects wrong state then accepts once and closes", async () => {
  let callback; let exchanges = 0; let stored = 0;
  const status = await signInChatGPT({ hostId: `urn:uuid:${randomUUID()}`, timeoutMs: 3000,
    credentials: { clientId: async () => null, store: async () => { stored++; }, remove: async () => {} },
    adapters: { exchange: async () => { exchanges++; return { id_token: "test", access_token: "test", token_type: "Bearer", scope: "chatgpt.tokens.use.direct resource.invoke" }; }, verifyIdentity: async () => ({ sub: "test" }) },
    openBrowser: async (value) => {
      const authorize = new URL(value); callback = new URL(authorize.searchParams.get("redirect_uri"));
      callback.search = new URLSearchParams({ state: "wrong", code: "test", client_id: "oaiapp_test" }).toString();
      assert.equal((await fetch(callback)).status, 400); assert.equal(exchanges, 0);
      callback.searchParams.set("state", authorize.searchParams.get("state"));
      assert.equal((await fetch(callback)).status, 200);
    },
  });
  assert.deepEqual(status, { provider: "chatgpt", state: "connected" });
  assert.equal(exchanges, 1); assert.equal(stored, 1);
  await assert.rejects(fetch(callback));
});

test("timeout closes the callback listener without activating a connection", async () => {
  let callback;
  const status = await signInChatGPT({ hostId: `urn:uuid:${randomUUID()}`, timeoutMs: 30,
    credentials: { clientId: async () => null }, openBrowser: async (value) => { callback = new URL(value).searchParams.get("redirect_uri"); } });
  assert.equal(status.state, "unavailable"); await assert.rejects(fetch(callback));
});

test("Windows DPAPI round-trip persists only ciphertext and locks concurrent hosts", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "aitmi-lab-dpapi-test-"));
  let store;
  try {
    store = await openWindowsCredentials(directory); const hostId = store.hostId;
    await assert.rejects(openWindowsCredentials(directory));
    await store.store({ clientId: "oaiapp_test", subject: "test-subject", tokens: { access_token: "test-private-marker" } });
    assert.equal((await readFile(join(directory, "chatgpt.dpapi"))).includes(Buffer.from("test-private-marker")), false);
    await store.close(); store = await openWindowsCredentials(directory);
    assert.equal(store.hostId, hostId); assert.equal(await store.clientId(), "oaiapp_test");
    await assert.rejects(store.store({ clientId: "oaiapp_test", subject: "different", tokens: {} }));
    await store.remove(); assert.equal(await store.clientId(), null);
  } finally { await store?.close(); await rm(directory, { recursive: true, force: true }); }
});
