import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { startPortal } from "../src/portal.mjs";
import { openWindowsCredentials } from "../src/windows-credentials.mjs";
import { createCopilotHost, copilotEnvironment } from "../src/copilot-host.mjs";

test("real provider sign-in owns its protected store until the browser attempt settles", { skip: process.platform !== "win32", timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "aitmi-portal-store-lifetime-"));
  let browserStarted;
  let rejectBrowser;
  const started = () => new Promise(resolve => { browserStarted = resolve; });
  const portal = await startPortal({ directory, openBrowser: async () => {
    browserStarted();
    await new Promise((_, reject) => { rejectBrowser = reject; });
  } });
  const url = new URL(portal.url);
  const headers = { authorization: `Bearer ${url.hash.slice(1)}`, origin: url.origin };
  try {
    for (const provider of ["chatgpt", "openrouter"]) {
      const enteredBrowser = started();
      assert.equal((await fetch(`${url.origin}/connect/${provider}`, { method: "POST", headers })).status, 202);
      await enteredBrowser;
      await assert.rejects(openWindowsCredentials(join(directory, "credentials"), provider), /credential-store-locked/);
      rejectBrowser(new Error("browser-unavailable"));
      let result;
      for (let attempt = 0; attempt < 100; attempt++) {
        result = await (await fetch(`${url.origin}/status`, { headers })).json();
        if (!result.busy.includes(provider)) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(result.busy.includes(provider), false);
      assert.equal(result.reasons[provider], "browser-unavailable");
      const reopened = await openWindowsCredentials(join(directory, "credentials"), provider);
      await reopened.close();
    }
  } finally {
    rejectBrowser?.(new Error("test-cleanup"));
    await portal.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Lab portal requires per-launch authorization and exact Origin for actions", async () => {
  let calls = 0;
  const portal = await startPortal({ directory: "unused", perform: async () => { calls++; return { state: "connected", access_token: "private-test-marker" }; } });
  const url = new URL(portal.url); const authorization = `Bearer ${url.hash.slice(1)}`;
  try {
    assert.equal((await fetch(`${url.origin}/status`)).status, 403);
    assert.equal((await fetch(`${url.origin}/connect/chatgpt`, { method: "POST", headers: { authorization } })).status, 400);
    assert.equal((await fetch(`${url.origin}/connect/chatgpt`, { method: "POST", headers: { authorization, origin: "https://evil.example" } })).status, 403);
    assert.equal((await fetch(`${url.origin}/connect/claude`, { method: "POST", headers: { authorization, origin: url.origin } })).status, 400);
    assert.equal(calls, 0);
    assert.equal((await fetch(`${url.origin}/connect/chatgpt`, { method: "POST", headers: { authorization, origin: url.origin } })).status, 202);
    const result = await (await fetch(`${url.origin}/status`, { headers: { authorization } })).json();
    assert.equal(result.states.chatgpt, "connected"); assert.equal(JSON.stringify(result).includes("private-test-marker"), false);
    const html = await (await fetch(url.origin)).text(); assert.match(html, /Disabled stub/); assert.match(html, /system browser/);
  } finally { await portal.stop(); }
  await assert.rejects(fetch(url.origin));
});

test("Lab portal binds one active operation per provider and strips provider errors", async () => {
  let finish;
  const portal = await startPortal({ directory: "unused", perform: () => new Promise((resolve) => { finish = resolve; }) });
  const url = new URL(portal.url); const headers = { authorization: `Bearer ${url.hash.slice(1)}`, origin: url.origin };
  try {
    assert.equal((await fetch(`${url.origin}/connect/openrouter`, { method: "POST", headers })).status, 202);
    assert.equal((await fetch(`${url.origin}/connect/openrouter`, { method: "POST", headers })).status, 409);
    finish({ state: "provider-private-error", token: "private" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const state = await (await fetch(`${url.origin}/status`, { headers })).json();
    assert.equal(state.states.openrouter, "unavailable");
    assert.equal(state.reasons.openrouter, "sign-in-incomplete");
    assert.equal(JSON.stringify(state).includes("provider-private-error"), false);
  } finally { await portal.stop(); }
});

test("Lab exposes only closed failure reasons, never raw credential or provider errors", async () => {
  let failure = "credential-store-locked";
  const portal = await startPortal({ directory: "unused", perform: async () => { throw new Error(failure); } });
  const url = new URL(portal.url); const headers = { authorization: `Bearer ${url.hash.slice(1)}`, origin: url.origin };
  try {
    for (const [code, reason] of [["credential-store-locked", "credential-store-locked"], ["private-secret-marker", "account-check-failed"]]) {
      failure = code;
      assert.equal((await fetch(`${url.origin}/check/chatgpt`, { method: "POST", headers })).status, 202);
      const result = await (await fetch(`${url.origin}/status`, { headers })).json();
      assert.equal(result.reasons.chatgpt, reason);
      assert.equal(JSON.stringify(result).includes("private-secret-marker"), false);
    }
  } finally { await portal.stop(); }
});

test("Copilot environment cannot inherit token, endpoint or telemetry overrides", () => {
  const env = copilotEnvironment("test-home");
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "COPILOT_GITHUB_TOKEN", "COPILOT_PROVIDER_BASE_URL", "OTEL_EXPORTER_OTLP_ENDPOINT"]) assert.equal(env[key], undefined);
  assert.equal(env.COPILOT_HOME, "test-home"); assert.equal(env.GH_CONFIG_DIR, join("test-home", "gh"));
});

const nativeModules = fileURLToPath(new URL("../../../apps/aitmi-local/vendor/copilot-native/node_modules/", import.meta.url));
test("Actual bundled Copilot CLI/SDK starts and reports an isolated unsigned-in account", { skip: process.platform !== "win32" || !existsSync(join(nativeModules, "@github", "copilot-win32-x64", "copilot.exe")), timeout: 45000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "aitmi-copilot-auth-test-"));
  const modules = fileURLToPath(new URL("../../../apps/aitmi-local/vendor/copilot-native/node_modules/", import.meta.url));
  const host = createCopilotHost({ home, executable: join(modules, "@github", "copilot-win32-x64", "copilot.exe"), sdkEntry: join(modules, "@github", "copilot-sdk", "dist", "index.js") });
  try {
    assert.deepEqual(await host.check(), { provider: "copilot", state: "not-configured" });
    await assert.rejects(host.models(), /not-configured/);
  }
  finally { host.stop(); await rm(home, { recursive: true, force: true }); }
});
