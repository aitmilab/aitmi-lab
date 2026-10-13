import { createOpenAIIdentityAdapters, jsonResponse } from "./chatgpt-host.mjs";
import { hasChatGPTPlanInferenceGrant } from "./chatgpt-scopes.mjs";

const ISSUER = "https://auth.openai.com";
export function chatGPTSessionStatus(account, now = Date.now()) {
  const tokens = account?.tokens;
  if (!tokens?.access_token) return { provider: "chatgpt", state: "not-configured" };
  if (!hasChatGPTPlanInferenceGrant(tokens.scope)) return { provider: "chatgpt", state: "limited" };
  const expiry = account.savedAt + tokens.expires_in * 1000;
  return { provider: "chatgpt", state: Number.isFinite(expiry) && expiry > now + 60000 ? "connected" : "expired" };
}

/** Caller holds the per-provider exclusive credential lock across refresh. */
export async function checkChatGPT(credentials, { fetchImpl = fetch, now = Date.now } = {}) {
  const account = await credentials.read();
  const current = chatGPTSessionStatus(account, now());
  if (current.state !== "expired" || !account?.tokens?.refresh_token) return current;
  try {
    const tokens = await createOpenAIIdentityAdapters({ fetchImpl }).exchange({ grant_type: "refresh_token",
      client_id: account.clientId, refresh_token: account.tokens.refresh_token, resource: "https://api.openai.com/v1" });
    if (typeof tokens.access_token !== "string" || !tokens.access_token || tokens.token_type?.toLowerCase() !== "bearer" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error("invalid-refresh");
    const next = { ...account, savedAt: now(), tokens: { ...tokens,
      id_token: tokens.id_token ?? account.tokens.id_token,
      refresh_token: tokens.refresh_token ?? account.tokens.refresh_token,
      scope: tokens.scope ?? account.tokens.scope } };
    await credentials.store(next);
    return chatGPTSessionStatus(next, now());
  } catch { return { provider: "chatgpt", state: "unavailable" }; }
}

export async function signOutChatGPT(credentials, fetchImpl = fetch) {
  const account = await credentials.read(); let remoteRevocationConfirmed = false;
  try {
    if (account?.tokens?.refresh_token) {
      const discovery = await jsonResponse(await fetchImpl(`${ISSUER}/.well-known/openid-configuration`, { redirect: "error", signal: AbortSignal.timeout(15000) }));
      const endpoint = new URL(discovery.revocation_endpoint);
      if (discovery.issuer !== ISSUER || endpoint.origin !== ISSUER || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) throw new Error("invalid-revocation-destination");
      const response = await fetchImpl(endpoint.href, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: account.tokens.refresh_token, token_type_hint: "refresh_token", client_id: account.clientId }).toString() });
      remoteRevocationConfirmed = response.status === 200 && !response.redirected;
    }
  } catch { /* Never expose provider errors or claim a remote session ended. */ }
  await credentials.signOut();
  return { provider: "chatgpt", state: "revoked", remoteRevocationConfirmed };
}
