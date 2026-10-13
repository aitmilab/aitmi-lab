import { createServer } from "node:http";
import { createPublicKey, verify } from "node:crypto";
import { createChatGPTLabFlow } from "./chatgpt.mjs";

const ISSUER = "https://auth.openai.com";

export async function jsonResponse(response) {
  if (!response.ok || response.redirected) throw new Error("provider-request-failed");
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) throw new Error("provider-response-too-large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Trusted host only. All network destinations are fixed; JWT headers cannot
 * select a key URL. No provider response/error/credential is exposed as status. */
export function createOpenAIIdentityAdapters({ fetchImpl = fetch, now = Date.now } = {}) {
  const request = (url, options = {}) => fetchImpl(url, {
    ...options, redirect: "error", signal: AbortSignal.timeout(15000),
  }).then(jsonResponse);
  return {
    exchange: (fields) => request(`${ISSUER}/api/accounts/oauth/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
    verifyIdentity: async (token, { audience, nonce, issuer }) => {
      if (issuer !== ISSUER || typeof token !== "string" || token.length > 32768) throw new Error("invalid-identity");
      const parts = token.split(".");
      if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error("invalid-identity");
      const header = JSON.parse(Buffer.from(parts[0], "base64url"));
      const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
      if (header.alg !== "RS256" || typeof header.kid !== "string" || header.crit) throw new Error("invalid-identity");
      const jwks = await request(`${ISSUER}/.well-known/jwks.json`);
      const keys = Array.isArray(jwks.keys) ? jwks.keys.filter((key) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256")) : [];
      if (keys.length !== 1 || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: keys[0], format: "jwk" }), Buffer.from(parts[2], "base64url"))) throw new Error("invalid-identity");
      const seconds = now() / 1000;
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (claims.iss !== ISSUER || !audiences.includes(audience) || (audiences.length > 1 && claims.azp !== audience) || typeof claims.exp !== "number" || claims.exp <= seconds || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > seconds)) || claims.nonce !== nonce || typeof claims.sub !== "string" || !claims.sub) throw new Error("invalid-identity");
      return { sub: claims.sub };
    },
  };
}

/** Start the private listener before opening the system browser. The caller
 * supplies OS-backed credentials; this module never creates plaintext storage. */
export async function signInChatGPT({ hostId, credentials, openBrowser, adapters = createOpenAIIdentityAdapters(), timeoutMs = 300000 }) {
  let flow; let finish; let timer; let callbackTask;
  const completed = new Promise((resolve) => { finish = resolve; });
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("x-content-type-options", "nosniff");
    const address = server.address();
    if (!address || callbackTask || req.method !== "GET" || req.headers.host !== `127.0.0.1:${address.port}` || req.headers.origin || !req.url?.startsWith("/auth/callback?") || req.url.length > 8192) {
      res.writeHead(400); res.end("Invalid sign-in callback."); return;
    }
    try {
      callbackTask = flow.complete(`http://127.0.0.1:${address.port}${req.url}`);
      const result = await callbackTask;
      res.writeHead(result.ok ? 200 : 400);
      res.end(result.ok ? "AITMI Lab sign-in verified. You may close this tab." : "Sign-in was not completed. Return to AITMI Lab.");
      if (flow.status().state !== "awaiting-user") finish(flow.status());
    } catch { if (!res.destroyed) { res.writeHead(400); res.end("Sign-in was not completed."); } finish({ provider: "chatgpt", state: "unavailable" }); }
    finally { callbackTask = null; }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    flow = createChatGPTLabFlow({ hostId, credentials, openBrowser, ...adapters,
      redirectUri: `http://127.0.0.1:${server.address().port}/auth/callback` });
    timer = setTimeout(() => finish({ provider: "chatgpt", state: "unavailable", reason: "sign-in-timeout" }), timeoutMs);
    if (!(await flow.begin()).ok) finish(flow.status());
    return await completed;
  } finally {
    clearTimeout(timer);
    flow?.cancelAttempt();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await callbackTask;
  }
}
