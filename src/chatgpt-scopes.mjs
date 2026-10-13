/** A ChatGPT identity token is not permission to invoke the Responses API.
 * Keep this check shared by initial sign-in and restored/refresh sessions.
 */
const REQUIRED_INFERENCE_SCOPES = Object.freeze(["chatgpt.tokens.use.direct", "resource.invoke"]);

export function hasChatGPTPlanInferenceGrant(scope) {
  if (typeof scope !== "string") return false;
  const granted = new Set(scope.trim().split(/\s+/));
  return REQUIRED_INFERENCE_SCOPES.every((required) => granted.has(required));
}
