import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke";
const secret = () => randomBytes(32).toString("base64url");
const equal = (left, right) => typeof right === "string" && Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));

/**
 * Privileged Lab host only. No Core dependency, exported tokens, or tool access.
 * Host supplies an OS-backed credential store, a browser launcher and an OIDC
 * verifier that checks signature/JWKS, issuer, audience, expiry and nonce.
 * Default CLI does not install those adapters or claim an active entitlement.
 */
export function createChatGPTLabFlow({ hostId, redirectUri, openBrowser, exchange, verifyIdentity, credentials, now = Date.now }) {
  if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hostId)) throw new Error("invalid-lab-host");
  const callback = new URL(redirectUri);
  if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" || !callback.port || callback.username || callback.password || callback.search || callback.hash) throw new Error("invalid-lab-callback");
  let attempt = null;
  let status = "unavailable";
  let epoch = 0;
  let preparing = false;
  let completing = false;
  let resetting = false;
  return Object.freeze({
    status: () => ({ provider: "chatgpt", state: status }),
    begin: async () => {
      if (attempt || preparing || completing || resetting) return { ok: false };
      preparing = true;
      try {
      const verifier = secret();
      const state = secret();
      const nonce = secret();
      const generation = ++epoch;
      const issuedClientId = await credentials.clientId();
      if (epoch !== generation) return { ok: false };
      if (issuedClientId !== null && !/^oaiapp_[a-zA-Z0-9_-]+$/.test(issuedClientId)) return { ok: false };
      attempt = { verifier, state, nonce, generation, clientId: issuedClientId, expires: now() + 300_000 };
      const url = new URL("https://auth.openai.com/api/accounts/authorize");
      const values = { response_type: "code", client_id: issuedClientId ?? "dynamic_agent_client", redirect_uri: redirectUri, resource: RESOURCE,
        scope: SCOPES, state, nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
        ext_agent_host_id: hostId };
      if (issuedClientId === null) values.agent_name_hint = "AITMI Lab";
      for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
      status = "awaiting-user";
      try { await openBrowser(url.href); return { ok: true }; }
      catch { if (epoch === generation) { attempt = null; status = "unavailable"; } return { ok: false }; }
      } catch { status = "unavailable"; return { ok: false }; }
      finally { preparing = false; }
    },
    complete: async (callbackUrl) => {
      const held = attempt;
      if (!held || completing || resetting) return { ok: false };
      let response;
      try { response = new URL(callbackUrl); } catch { return { ok: false }; }
      if (response.origin !== callback.origin || response.pathname !== callback.pathname || response.hash || response.username || response.password) return { ok: false };
      if (["state", "code", "client_id", "error"].some((key) => response.searchParams.getAll(key).length > 1) || !equal(held.state, response.searchParams.get("state"))) return { ok: false };
      attempt = null; // Consume even a failed exchange; codes cannot be replayed.
      status = "unavailable";
      const code = response.searchParams.get("code");
      const clientId = held.clientId ?? response.searchParams.get("client_id");
      if (held.clientId && response.searchParams.has("client_id") && response.searchParams.get("client_id") !== held.clientId) return { ok: false };
      if (held.expires <= now() || response.searchParams.has("error") || !code || code.length > 4096 || !/^oaiapp_[a-zA-Z0-9_-]+$/.test(clientId ?? "")) return { ok: false };
      completing = true;
      try {
        const tokens = await exchange({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: held.verifier, redirect_uri: redirectUri, resource: RESOURCE });
        const identity = await verifyIdentity(tokens.id_token, { audience: clientId, nonce: held.nonce, issuer: "https://auth.openai.com" });
        if (!identity || typeof identity.sub !== "string" || !identity.sub || epoch !== held.generation) return { ok: false };
        const granted = typeof tokens.scope === "string" && tokens.scope.split(/\s+/).includes("chatgpt.tokens.use.direct");
        if (!granted || typeof tokens.access_token !== "string" || !tokens.access_token || tokens.token_type?.toLowerCase() !== "bearer") {
          status = "limited"; return { ok: false };
        }
        // The broker verifies the returning account matches its selected identity.
        // It stores tokens only for Lab and exposes no credential to tools/Core.
        await credentials.store({ clientId, subject: identity.sub, tokens });
        if (epoch !== held.generation) { await credentials.remove(); return { ok: false }; }
        status = "connected";
        return { ok: true };
      } catch { return { ok: false }; }
      finally { completing = false; }
    },
    disconnect: async () => {
      if (resetting) return { ok: false };
      resetting = true;
      ++epoch; attempt = null; status = "unavailable";
      try { await credentials.remove(); status = "revoked"; return { ok: true }; }
      catch { return { ok: false }; }
      finally { resetting = false; }
    },
  });
}
