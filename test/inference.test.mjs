import test from "node:test";
import assert from "node:assert/strict";
import { accountModels, completedResponse, testInference, TEST_TEXT } from "../src/inference.mjs";
import { createCopilotHost, probeSessionConfig } from "../src/copilot-host.mjs";
import { startPortal } from "../src/portal.mjs";

const credentials = { read: async () => ({ savedAt: Date.now(), tokens: { access_token: "synthetic-token", expires_in: 3600, scope: "chatgpt.tokens.use.direct resource.invoke" }, key: "synthetic-key" }) };
const completion = (text = "AITMI_OK", model = "test-model", withReasoning = false) => `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", model, error: null, incomplete_details: null, output: [...(withReasoning ? [{ type: "reasoning", encrypted_content: "opaque-invented-reasoning" }] : []), { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] } })}\n\n`;

test("ChatGPT catalog uses selected account and projects only visible public model fields", async () => {
  const models = await accountModels("chatgpt", credentials, { fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/models"); assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, "Bearer synthetic-token");
    return Response.json({ models: [{ slug: "test-model", display_name: "Test model", visibility: "list", token: "private" }, { slug: "hidden", visibility: "hidden" }] });
  } });
  assert.deepEqual(models, [{ id: "test-model", name: "Test model" }]);
});
test("ChatGPT inference dispatch is fixed, no-store, streamed and complete-only", async () => {
  const result = await testInference("chatgpt", credentials, "test-model", { fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses"); assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body);
    assert.deepEqual(body, { model: "test-model", input: [{ role: "user", content: TEST_TEXT }], store: false, stream: true });
    return new Response(completion(), { headers: { "content-type": "text/event-stream" } });
  } });
  assert.deepEqual(result, { provider: "chatgpt", state: "inference-completed", exactTestPassed: true });
});
test("Responses incomplete, failed, usage-error, duplicate completion and raw deltas cannot prove inference", () => {
  for (const stream of ["data: {\"type\":\"response.output_text.delta\",\"delta\":\"AITMI_OK\"}\n\n", ...["response.failed", "response.incomplete", "error"].map(type => `data: ${JSON.stringify({ type })}\n\n`), completion() + completion(), completion() + 'data: {"type":"response.failed"}\n\n']) assert.throws(() => completedResponse(stream));
  for (const stream of ['data: [DONE]\n\n' + completion(), completion() + 'data: [DONE]\n\ndata: {"type":"response.output_text.delta"}\n\n', completion() + 'data: [DONE]\n\ndata: [DONE]\n\n']) assert.throws(() => completedResponse(stream));
});
test("ChatGPT probe accepts one normal stream terminator after exact completion", () => {
  assert.equal(completedResponse(completion() + "data: [DONE]\n\n", "test-model"), "AITMI_OK");
  assert.equal(completedResponse(completion("AITMI_OK", "test-model", true) + "data: [DONE]\n\n", "test-model"), "AITMI_OK");
});
test("ChatGPT probe refuses a substituted model or incomplete terminal even with the expected answer", async () => {
  for (const stream of [completion("AITMI_OK", "other-model"), completion().replace('"status":"completed"', '"status":"incomplete"'),
    completion().replace('"error":null', '"error":{"code":"failed"}')]) {
    await assert.rejects(testInference("chatgpt", credentials, "test-model", { fetchImpl: async () => new Response(stream,
      { headers: { "content-type": "text/event-stream" } }) }));
  }
});
test("Missing plan grant and unsafe models prevent any provider request", async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw 0; };
  await assert.rejects(testInference("chatgpt", { read: async () => ({ tokens: { access_token: "no-plan", scope: "openid" } }) }, "test", { fetchImpl }));
  await assert.rejects(testInference("chatgpt", { read: async () => ({ savedAt: Date.now(), tokens: { access_token: "no-resource", scope: "chatgpt.tokens.use.direct", expires_in: 3600 } }) }, "test", { fetchImpl }));
  await assert.rejects(testInference("openrouter", credentials, "https://evil.example?key=secret", { fetchImpl }));
  assert.equal(calls, 0);
});
test("OpenRouter probe uses isolated OAuth key, no automatic fallback and only a completed reply", async () => {
  const result = await testInference("openrouter", credentials, "test/model", { fetchImpl: async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(init.body); assert.equal(body.provider.allow_fallbacks, false);
    assert.deepEqual(body.messages, [{ role: "user", content: TEST_TEXT }]);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "AITMI_OK" } }], key: "private" });
  } });
  assert.equal(result.exactTestPassed, true); assert.equal(JSON.stringify(result).includes("private"), false);
  await assert.rejects(testInference("openrouter", credentials, "test/model", { fetchImpl: async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "AITMI_OK" } }] }) }));
});
test("Copilot probe uses an empty runtime, account models, deny-all tools and guaranteed cleanup", async () => {
  let stopped = 0; let disconnected = 0;
  const host = createCopilotHost({ home: "unused-test-home", clientFactory: options => {
    assert.equal(options.mode, "empty"); assert.equal(options.env.GH_TOKEN, undefined);
    return { start: async () => {}, getAuthStatus: async () => ({ isAuthenticated: true }), listModels: async () => [{ id: "test", name: "Test" }], stop: async () => { stopped++; },
      createSession: async config => { assert.deepEqual(config.availableTools, []); assert.equal(config.enableSkills, false); assert.equal(config.enableSessionStore, false); assert.notEqual(config.onPermissionRequest().kind, "approved");
        return { sendAndWait: async ({ prompt }) => { assert.equal(prompt, TEST_TEXT); return { type: "assistant.message", data: { content: "AITMI_OK" } }; }, disconnect: async () => { disconnected++; } }; } };
  } });
  assert.equal((await host.probe("test")).exactTestPassed, true);
  await assert.rejects(host.probe("foreign")); assert.equal(stopped, 2); assert.equal(disconnected, 1);
  assert.equal(probeSessionConfig("home", "test").enableFileHooks, false);
  assert.equal(probeSessionConfig("home", "test").onPermissionRequest().kind, "denied-no-approval-rule-and-could-not-request-from-user");
});
test("Portal requires a listed model and accepts no arbitrary prompt or credential for inference", async () => {
  let sent = 0;
  const portal = await startPortal({ directory: "unused", perform: async (provider, action, model) => {
    if (action === "models") return { models: [{ id: "test", name: "Test", key: "secret" }] };
    assert.equal(action, "probe"); assert.equal(model, "test"); sent++;
    return { state: "inference-completed", exactTestPassed: true, access_token: "secret" };
  } });
  const url = new URL(portal.url); const headers = { authorization: `Bearer ${url.hash.slice(1)}`, origin: url.origin };
  const post = (path, body) => fetch(url.origin + path, { method: "POST", headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await post("/probe/chatgpt", { model: "test" })).status, 400);
    assert.equal((await post("/models/chatgpt")).status, 202);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await post("/probe/chatgpt", { model: "test", prompt: "private" })).status, 400);
    assert.equal((await post("/probe/chatgpt", { model: "foreign" })).status, 400);
    assert.equal((await post("/probe/chatgpt", { model: "test" })).status, 202);
    await new Promise(resolve => setTimeout(resolve, 10));
    const state = await (await fetch(url.origin + "/status", { headers })).json();
    assert.deepEqual(state.probes.chatgpt, { completed: true, exactTestPassed: true });
    assert.equal(JSON.stringify(state).includes("secret"), false); assert.equal(sent, 1);
  } finally { await portal.stop(); }
});
