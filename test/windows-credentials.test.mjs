import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { openWindowsCredentials } from "../src/windows-credentials.mjs";
import { createChatGPTLabFlow } from "../src/chatgpt.mjs";

test("disposable Windows protected store prepares and reopens independent provider records", {
  skip: process.platform !== "win32",
}, async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, "aitmi-lab-credential-probe-"));
  let chatgpt, openrouter;
  try {
    chatgpt = await openWindowsCredentials(root, "chatgpt");
    assert.match(chatgpt.hostId, /^urn:uuid:[0-9a-f-]{36}$/);
    assert.equal(await chatgpt.clientId(), null);
    const originalHost = chatgpt.hostId;
    await chatgpt.close(); chatgpt = null;

    chatgpt = await openWindowsCredentials(root, "chatgpt");
    assert.equal(chatgpt.hostId, originalHost);
    assert.equal(await chatgpt.clientId(), null);
    let preparedUrl = null;
    const flow = createChatGPTLabFlow({ hostId: chatgpt.hostId,
      redirectUri: "http://127.0.0.1:49152/auth/callback",
      credentials: chatgpt,
      openBrowser: async url => { preparedUrl = new URL(url); },
      exchange: async () => { throw new Error("no exchange in preparation probe"); },
      verifyIdentity: async () => { throw new Error("no identity in preparation probe"); },
    });
    assert.deepEqual(await flow.begin(), { ok: true });
    assert.equal(preparedUrl.origin, "https://auth.openai.com");
    assert.equal(preparedUrl.pathname, "/api/accounts/authorize");
    assert.equal(preparedUrl.searchParams.get("client_id"), "dynamic_agent_client");
    assert.equal(preparedUrl.searchParams.get("ext_agent_host_id"), originalHost);
    flow.cancelAttempt();
    await chatgpt.close(); chatgpt = null;

    openrouter = await openWindowsCredentials(root, "openrouter");
    assert.equal(await openrouter.read(), null);
    await openrouter.store({ key: "sk-or-v1-invented-probe-only" });
    await openrouter.close(); openrouter = null;
    openrouter = await openWindowsCredentials(root, "openrouter");
    assert.equal((await openrouter.read()).key, "sk-or-v1-invented-probe-only");
    await openrouter.remove();
    await openrouter.close(); openrouter = null;
  } finally {
    if (chatgpt) await chatgpt.close();
    if (openrouter) await openrouter.close();
    const resolved = await realpath(root);
    const within = relative(parent, resolved);
    if (!within || within.startsWith("..") || isAbsolute(within) ||
      !within.startsWith("aitmi-lab-credential-probe-"))
      throw new Error("credential-probe-cleanup-path-refused");
    await rm(resolved, { recursive: true, force: false });
  }
});
