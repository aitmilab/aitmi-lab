const PROVIDERS = new Set(["chatgpt", "openai-api", "claude", "github-copilot", "grok", "openrouter", "requesty", "ollama", "lm-studio"]);

export function createProfile() {
  return { version: 1, connections: [] };
}

export function profileView(profile) {
  const connections = Array.isArray(profile?.connections) ? profile.connections : [];
  return connections.filter(validateConnection).map(({ provider, state }) => ({ provider, state }));
}

/** Rejects rather than carries credentials, identities or unrecognised fields. */
export function validateConnection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = Object.keys(value);
  if (fields.length !== 2 || !fields.includes("provider") || !fields.includes("state")) return false;
  return PROVIDERS.has(value.provider) && ["unavailable", "awaiting-user", "connected", "revoked"].includes(value.state);
}
