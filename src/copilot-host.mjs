import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { publicModels, validModel, TEST_TEXT } from "./inference.mjs";

export const probeSessionConfig = (home, model) => ({ model, workingDirectory: home,
  availableTools: [], excludedTools: ["builtin:*", "mcp:*", "custom:*"], tools: [], mcpServers: {},
  skipCustomInstructions: true, enableConfigDiscovery: false, enableOnDemandInstructionDiscovery: false,
  enableFileHooks: false, enableHostGitOperations: false, enableSessionStore: false, enableSkills: false,
  remoteSession: "off", infiniteSessions: { enabled: false },
  onPermissionRequest: () => ({ kind: "denied-no-approval-rule-and-could-not-request-from-user" }) });

export function copilotEnvironment(home) {
  // Never adopt shell credentials, custom endpoints, repo tools or telemetry.
  const env = {};
  for (const name of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]) if (process.env[name]) env[name] = process.env[name];
  return { ...env, COPILOT_HOME: home, GH_CONFIG_DIR: join(home, "gh"), COPILOT_OTEL_ENABLED: "false" };
}

export function createCopilotHost({ executable, sdkEntry, home, clientFactory }) {
  const children = new Set();
  const status = (state) => ({ provider: "copilot", state });
  const secureConfig = async () => {
    // The vendor can fall back to a file: never certify that as secure storage.
    try {
      const config = await readFile(join(home, "config.json"), "utf8");
      if (/"(?:[a-z_]*token)"\s*:\s*"[^\"]+"/i.test(config)) return false;
    } catch (error) { if (error.code !== "ENOENT") return false; }
    return true;
  };
  const useClient = async (operation) => {
    let client;
    try {
      if (!await secureConfig()) throw new Error("storage-needs-attention");
      const options = { cliPath: executable, cwd: home, env: copilotEnvironment(home), autoStart: false, autoRestart: false, mode: "empty", baseDirectory: join(home, "sessions") };
      if (clientFactory) client = clientFactory(options);
      else { const { CopilotClient } = await import(pathToFileURL(sdkEntry).href); client = new CopilotClient(options); }
      await client.start();
      if ((await client.getAuthStatus()).isAuthenticated !== true) throw new Error("not-configured");
      return await operation(client);
    } finally { if (client) await client.stop().catch(() => {}); }
  };
  return {
    async models() { return useClient(async client => publicModels(await client.listModels(), "copilot")); },
    async probe(model) {
      if (!validModel(model)) throw new Error("invalid-model");
      return useClient(async client => {
        if (!publicModels(await client.listModels(), "copilot").some(item => item.id === model)) throw new Error("model-unavailable");
        const session = await client.createSession(probeSessionConfig(home, model));
        try {
          const answer = await session.sendAndWait({ prompt: TEST_TEXT }, 30000);
          if (answer?.type !== "assistant.message" || typeof answer.data?.content !== "string") throw new Error("inference-incomplete");
          return { provider: "copilot", state: "inference-completed", exactTestPassed: answer.data.content.trim() === "AITMI_OK" };
        } finally { await session.disconnect(); }
      });
    },
    async check() {
      let client;
      try {
        if (!await secureConfig()) return status("storage-needs-attention");
        const { CopilotClient } = await import(pathToFileURL(sdkEntry).href);
        client = new CopilotClient({ cliPath: executable, cwd: home, env: copilotEnvironment(home), autoStart: false, autoRestart: false });
        await client.start();
        const auth = await client.getAuthStatus();
        if (auth.isAuthenticated !== true) return status("not-configured");
        const models = await client.listModels();
        return status(Array.isArray(models) && models.length > 0 ? "connected" : "limited");
      } catch { return status("unavailable"); }
      finally { if (client) await client.stop().catch(() => {}); }
    },
    async connect() {
      await mkdir(home, { recursive: true });
      const ok = await new Promise((resolve) => {
        const child = spawn(executable, ["login", "--web-flow"], { cwd: home, env: copilotEnvironment(home), windowsHide: true, stdio: "ignore" });
        children.add(child); const timer = setTimeout(() => child.kill(), 300000);
        child.once("error", () => { clearTimeout(timer); children.delete(child); resolve(false); });
        child.once("close", (code) => { clearTimeout(timer); children.delete(child); resolve(code === 0); });
      });
      return ok ? this.check() : status("unavailable");
    },
    // Provider's own UI owns remote account management, not invented revocation.
    stop() { for (const child of children) child.kill(); },
  };
}
