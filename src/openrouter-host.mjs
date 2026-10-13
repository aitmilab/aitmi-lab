import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jsonResponse } from "./chatgpt-host.mjs";

/** OpenRouter's documented PKCE returns a user-controlled API key, not a
 * ChatGPT/Claude subscription. This standalone host has no Core/tool access. */
export async function signInOpenRouter({ credentials, openBrowser, fetchImpl = fetch, timeoutMs = 300000 }) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  let finish; let timer; let consumed = false; let cancelled = false; let exchangeTask;
  const completed = new Promise((resolve) => { finish = resolve; });
  const status = (value) => ({ provider: "openrouter", state: value });
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store"); res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("x-content-type-options", "nosniff");
    const address = server.address();
    if (!address || req.method !== "GET" || req.headers.host !== `127.0.0.1:${address.port}` || req.headers.origin || !req.url?.startsWith("/auth/callback?") || req.url.length > 8192) { res.writeHead(400); res.end("Invalid sign-in callback."); return; }
    const callback = new URL(req.url, `http://127.0.0.1:${address.port}`);
    const returned = callback.searchParams.get("state");
    if (consumed || cancelled || !returned || Buffer.byteLength(returned) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(returned), Buffer.from(state)) || ["code", "state", "error"].some((key) => callback.searchParams.getAll(key).length > 1)) { res.writeHead(400); res.end("Invalid sign-in callback."); return; }
    consumed = true;
    exchangeTask = (async () => {
      try {
        const code = callback.searchParams.get("code");
        if (callback.searchParams.has("error") || !code || code.length > 4096) throw new Error("sign-in-declined");
        const response = await fetchImpl("https://openrouter.ai/api/v1/auth/keys", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
        });
        const data = await jsonResponse(response);
        if (cancelled || typeof data.key !== "string" || data.key.length < 16 || data.key.length > 4096 || /[\u0000-\u001f\u007f]/.test(data.key)) throw new Error("invalid-key");
        await credentials.store({ key: data.key });
        if (cancelled) { await credentials.remove(); throw new Error("sign-in-cancelled"); }
        res.writeHead(200); res.end("OpenRouter sign-in saved in AITMI Lab. Close this tab and run the account check.");
        finish(status("connected"));
      } catch { if (!res.destroyed) { res.writeHead(400); res.end("Sign-in was not completed. Return to AITMI Lab."); } finish(status("unavailable")); }
    })();
    await exchangeTask;
  });
  server.headersTimeout = 10000; server.requestTimeout = 15000;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const url = new URL("https://openrouter.ai/auth");
    const callback = new URL(`/auth/callback?state=${state}`, `http://127.0.0.1:${server.address().port}`);
    // Include state in callback_url as well; do not rely on undocumented echo.
    url.search = new URLSearchParams({ callback_url: callback.href, state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    timer = setTimeout(() => { cancelled = true; finish(status("unavailable")); }, timeoutMs);
    await openBrowser(url.href);
    return await completed;
  } finally {
    clearTimeout(timer); cancelled = true; server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await exchangeTask;
  }
}

export async function checkOpenRouter(credentials, fetchImpl = fetch) {
  const account = await credentials.read();
  if (!account?.key) return { provider: "openrouter", state: "not-configured" };
  try {
    const response = await fetchImpl("https://openrouter.ai/api/v1/key", { redirect: "error",
      headers: { authorization: `Bearer ${account.key}` }, signal: AbortSignal.timeout(15000) });
    if (response.status === 401 || response.status === 403) return { provider: "openrouter", state: "expired" };
    const body = await jsonResponse(response);
    return { provider: "openrouter", state: body?.data && typeof body.data === "object" ? "connected" : "unavailable" };
  } catch { return { provider: "openrouter", state: "unavailable" }; }
}
