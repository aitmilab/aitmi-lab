#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { signInChatGPT } from "./chatgpt-host.mjs";
import { signInOpenRouter, checkOpenRouter } from "./openrouter-host.mjs";
import { checkChatGPT, signOutChatGPT } from "./chatgpt-session.mjs";
import { openWindowsCredentials, openWindowsBrowser } from "./windows-credentials.mjs";
import { createProfile, profileView } from "./profile.mjs";
import { validateManifest } from "./manifest.mjs";

const args = process.argv.slice(2);
const command = args[0];
const option = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1] ?? null; };
const profilePath = () => resolve(option("--profile") ?? "aitmi-lab-profile.json");

async function readProfile(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return createProfile(); }
}

async function main() {
  if (["connect", "check", "disconnect"].includes(command)) {
    const provider = args[1];
    if (!["chatgpt", "openrouter"].includes(provider) || process.platform !== "win32") {
      process.stdout.write("Use: aitmi-lab connect|check|disconnect chatgpt|openrouter (Windows protected companion host).\n");
      process.exitCode = 1; return;
    }
    const directory = join(homedir(), "AppData", "Local", "AITMI-Lab", "credentials");
    const credentials = await openWindowsCredentials(directory, provider);
    try {
      let status;
      if (command === "connect") {
        process.stdout.write(`Continue with ${provider === "chatgpt" ? "ChatGPT" : "OpenRouter"} in your browser. This signs in AITMI Lab only.\n`);
        status = await (provider === "chatgpt" ? signInChatGPT : signInOpenRouter)({ hostId: credentials.hostId, credentials, openBrowser: openWindowsBrowser });
      } else if (command === "check") {
        status = await (provider === "chatgpt" ? checkChatGPT : checkOpenRouter)(credentials);
      } else if (provider === "chatgpt") {
        status = await signOutChatGPT(credentials);
      } else {
        await credentials.remove();
        status = { provider, state: "revoked", remoteRevocationConfirmed: false };
        process.stdout.write("The local OpenRouter key was removed. Revoke the key in OpenRouter to end remote access.\n");
      }
      process.stdout.write(JSON.stringify(status) + "\n");
      process.exitCode = ["connected", "revoked"].includes(status.state) ? 0 : 1;
    } finally { await credentials.close(); }
    return;
  }
  if (command === "validate-tool") {
    const directory = resolve(args[1] ?? ".");
    const manifest = JSON.parse(await readFile(resolve(directory, "aitmi-tool.json"), "utf8"));
    if (!validateManifest(manifest)) throw new Error("invalid-tool-manifest");
    process.stdout.write("Tool manifest is valid. No capabilities have been granted and no tool was executed.\n");
    return;
  }
  if (command === "init") {
    const path = profilePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(createProfile(), null, 2) + "\n", { encoding: "utf8", flag: "wx" }).catch(async (error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    process.stdout.write("AITMI Lab profile is ready. No provider is connected.\n");
    return;
  }
  if (command === "status") {
    process.stdout.write(JSON.stringify({ connections: profileView(await readProfile(profilePath())) }, null, 2) + "\n");
    return;
  }
  if (command === "create-tool") {
    const name = args[1];
    const out = option("--out");
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(name ?? "") || !out) throw new Error("Use: create-tool <lowercase-name> --out <directory>");
    const directory = resolve(out);
    await mkdir(directory, { recursive: true });
    const manifest = { version: 1, id: `aitmi-lab.${name}`, name, capabilities: [], entry: "index.mjs" };
    await writeFile(resolve(directory, "aitmi-tool.json"), JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    await writeFile(resolve(directory, "index.mjs"), "export async function run() { return { type: 'text', text: 'Hello from AITMI Lab.' }; }\n", { encoding: "utf8", flag: "wx" });
    process.stdout.write("Tool template created. Declare capabilities before requesting AI.TMI data.\n");
    return;
  }
  process.stdout.write("Usage: aitmi-lab init|status|create-tool|validate-tool|connect|check|disconnect\n");
  process.exitCode = 1;
}

main().catch(() => { process.stderr.write("AITMI Lab could not complete that command.\n"); process.exitCode = 1; });
