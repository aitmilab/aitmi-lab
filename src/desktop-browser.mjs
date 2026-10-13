import { randomBytes } from "node:crypto";

/** Desktop only: opening a browser is owned by Electron, not PowerShell.
 * Authorization URLs remain in trusted host memory, never the Lab renderer. */
export function createDesktopBrowser(channel = process, timeoutMs = 15000) {
  const pending = new Map();
  const receive = value => {
    if (!value || Object.keys(value).length !== 3 || value.kind !== "lab-provider-browser-result" ||
        typeof value.id !== "string" || typeof value.ok !== "boolean") return;
    const finish = pending.get(value.id);
    if (finish) finish(value.ok);
  };
  channel.on("message", receive);
  return {
    open: url => new Promise((resolve, reject) => {
      if (!channel.connected || typeof channel.send !== "function") return reject(new Error("browser-unavailable"));
      const id = randomBytes(16).toString("hex");
      const finish = ok => { clearTimeout(timer); pending.delete(id); ok ? resolve() : reject(new Error("browser-unavailable")); };
      const timer = setTimeout(() => finish(false), timeoutMs);
      pending.set(id, finish);
      channel.send({ kind: "lab-open-provider-browser", id, url }, error => { if (error && pending.has(id)) finish(false); });
    }),
    close: () => { channel.removeListener("message", receive); for (const finish of pending.values()) finish(false); },
  };
}
