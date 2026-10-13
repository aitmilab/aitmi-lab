import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// DPAPI input is piped, never placed in process arguments, environment or logs.
async function protect(value, decrypt = false) {
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let output = ""; const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on("data", (chunk) => { output += chunk; if (output.length > 262144) child.kill(); });
    child.stdin.on("error", () => {});
    child.once("error", () => { clearTimeout(timer); reject(new Error("credential-protection-unavailable")); });
    child.once("close", (code) => { clearTimeout(timer); if (code !== 0 || !/^[A-Za-z0-9+/=]+$/.test(output)) reject(new Error("credential-protection-unavailable")); else resolve(Buffer.from(output, "base64")); });
    child.stdin.end(Buffer.from(value).toString("base64"));
  });
}

/** Single-account Windows companion store. An exclusive lock prevents rotating
 * credentials or disconnect racing another Lab process. No plaintext fallback. */
export async function openWindowsCredentials(directory, provider = "chatgpt") {
  if (process.platform !== "win32") throw new Error("unsupported-credential-store");
  if (!["chatgpt", "openrouter"].includes(provider)) throw new Error("unsupported-provider");
  await mkdir(directory, { recursive: true });
  const lock = join(directory, `${provider}.lock`);
  const acquire = () => writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: "wx" });
  try { await acquire(); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(lock, "utf8"));
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw new Error("credential-store-locked");
    try { process.kill(previous.pid, 0); throw new Error("credential-store-locked"); }
    catch (ownerError) { if (ownerError.code !== "ESRCH") throw ownerError; }
    // Recover only a lock whose owner no longer exists. A live/reused PID wins.
    await unlink(lock); await acquire();
  }
  const file = join(directory, `${provider}.dpapi`);
  let record;
  const save = async () => {
    const encrypted = await protect(Buffer.from(JSON.stringify(record)));
    const temporary = join(directory, `${randomUUID()}.tmp`);
    try { await writeFile(temporary, encrypted, { flag: "wx", mode: 0o600 }); await rename(temporary, file); }
    finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  };
  try {
    try { record = JSON.parse((await protect(await readFile(file), true)).toString("utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; record = { hostId: `urn:uuid:${randomUUID()}`, account: null }; await save(); }
    const validAccount = provider === "chatgpt"
      ? record.account === null || (/^oaiapp_[a-zA-Z0-9_-]+$/.test(record.account?.clientId ?? "") && typeof record.account.subject === "string")
      : record.account === null || (typeof record.account?.key === "string" && record.account.key.length >= 16 && record.account.key.length <= 4096);
    if (!/^urn:uuid:[0-9a-f-]{36}$/.test(record?.hostId ?? "") || !validAccount) throw new Error("invalid-credential-record");
    return {
      hostId: record.hostId,
      clientId: async () => record.account?.clientId ?? null,
      subject: async () => record.account?.subject ?? null,
      // Privileged host only; never expose this method through renderer/tool IPC.
      read: async () => record.account ? structuredClone(record.account) : null,
      store: async (account) => {
        if (provider === "chatgpt" && record.account && (record.account.clientId !== account.clientId || record.account.subject !== account.subject)) throw new Error("account-mismatch");
        record.account = { ...account, savedAt: Date.now() }; await save();
      },
      remove: async () => { record.account = null; await save(); },
      signOut: async () => { record.account = provider === "chatgpt" && record.account ? { clientId: record.account.clientId, subject: record.account.subject, tokens: null } : null; await save(); },
      close: async () => { record = null; await unlink(lock); },
    };
  } catch { await unlink(lock); throw new Error("credential-store-unavailable"); }
}

export async function openWindowsBrowser(url) {
  const target = new URL(url);
  if (!((target.origin === "https://auth.openai.com" && target.pathname === "/api/accounts/authorize") || (target.origin === "https://openrouter.ai" && target.pathname === "/auth"))) throw new Error("invalid-sign-in-destination");
  await new Promise((resolve, reject) => {
    // Encoded command carries only the public authorize URI, never bearer tokens.
    const script = `Start-Process -FilePath '${target.href.replaceAll("'", "''")}'`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true, stdio: "ignore" });
    child.once("error", () => reject(new Error("browser-unavailable")));
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("browser-unavailable")));
  });
}
