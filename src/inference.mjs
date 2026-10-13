import { checkChatGPT } from "./chatgpt-session.mjs";

export const TEST_TEXT = "Reply with exactly AITMI_OK and nothing else.";
export const validModel = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/~-]{0,159}$/.test(value);
export function publicModels(rows, provider) {
  if (!Array.isArray(rows)) return [];
  const result = []; const seen = new Set();
  for (const row of rows) {
    const id = provider === "chatgpt" ? row?.slug : row?.id;
    const name = provider === "chatgpt" ? row?.display_name : row?.name;
    if (!validModel(id) || seen.has(id) || provider === "chatgpt" && row.visibility !== "list") continue;
    seen.add(id); result.push({ id, name: typeof name === "string" && name.length <= 160 && !/[\x00-\x1f\x7f]/.test(name) ? name : id });
    if (result.length >= 1000) break;
  }
  return result;
}

async function bounded(response, limit) {
  if (!response.ok || response.redirected || !response.body) throw new Error("provider-unavailable");
  const reader = response.body.getReader(); let text = ""; let size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw new Error("response-too-large");
      text += decoder.decode(value, { stream: true }); }
    return text + decoder.decode();
  } finally { await reader.cancel(); }
}

async function bearer(provider, credentials, fetchImpl) {
  if (provider === "chatgpt") {
    if ((await checkChatGPT(credentials, { fetchImpl })).state !== "connected") throw new Error("grant-unavailable");
    return (await credentials.read()).tokens.access_token;
  }
  if (provider !== "openrouter") throw new Error("unsupported-provider");
  const account = await credentials.read();
  if (typeof account?.key !== "string" || !account.key) throw new Error("grant-unavailable");
  return account.key;
}

export async function accountModels(provider, credentials, { fetchImpl = fetch } = {}) {
  const token = await bearer(provider, credentials, fetchImpl);
  const url = provider === "chatgpt" ? "https://api.openai.com/v1/models" : "https://openrouter.ai/api/v1/models/user";
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${token}` } });
  const body = JSON.parse(await bounded(response, 8 * 1024 * 1024));
  return publicModels(provider === "chatgpt" ? body.models : body.data, provider);
}

export function completedResponse(stream, expectedModel = null) {
  let completed, done = false;
  for (const frame of stream.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) continue;
    if (data === "[DONE]") {
      if (!completed || done) throw new Error("invalid-completion");
      done = true;
      continue;
    }
    if (done || completed) throw new Error("invalid-completion");
    const event = JSON.parse(data);
    if (["error", "response.failed", "response.incomplete"].includes(event.type)) throw new Error("inference-failed");
    if (event.type === "response.completed") {
      if (completed || event.response?.status !== "completed" || event.response.error != null ||
        event.response.incomplete_details != null ||
        (expectedModel !== null && event.response.model !== expectedModel)) throw new Error("invalid-completion");
      completed = event.response;
    }
  }
  if (!completed) throw new Error("inference-incomplete");
  if (!Array.isArray(completed.output) || completed.output.length < 1 ||
    completed.output.some(item => item?.type !== "reasoning" && item?.type !== "message"))
    throw new Error("unsupported-output");
  const messages = completed.output.filter(item => item.type === "message");
  if (messages.length !== 1) throw new Error("unsupported-output");
  const message = messages[0];
  if (message.type !== "message" || message.role !== "assistant" || message.status !== "completed" ||
    !Array.isArray(message.content) || message.content.length < 1) throw new Error("unsupported-output");
  const content = message.content;
  if (content.some(item => item.type !== "output_text" || typeof item.text !== "string" ||
    (item.annotations !== undefined && (!Array.isArray(item.annotations) || item.annotations.length !== 0)))) throw new Error("unsupported-output");
  return content.map(item => item.text).join("");
}

/** Explicit fixed, invented prompt only. No Core draft, document or memory API. */
export async function testInference(provider, credentials, model, { fetchImpl = fetch } = {}) {
  if (!validModel(model)) throw new Error("invalid-model");
  const token = await bearer(provider, credentials, fetchImpl);
  const response = await fetchImpl(provider === "chatgpt" ? "https://api.openai.com/v1/responses" : "https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(provider === "chatgpt" ? { model, input: [{ role: "user", content: TEST_TEXT }], store: false, stream: true }
      : { model, messages: [{ role: "user", content: TEST_TEXT }], stream: false, max_tokens: 512, provider: { allow_fallbacks: false } }),
  });
  const raw = await bounded(response, 512 * 1024);
  let text;
  if (provider === "chatgpt") {
    if (!response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("invalid-response-type");
    text = completedResponse(raw, model);
  } else {
    const body = JSON.parse(raw); const choice = body.choices?.[0];
    if (body.error || choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string") throw new Error("inference-incomplete");
    text = choice.message.content;
  }
  return { provider, state: "inference-completed", exactTestPassed: typeof text === "string" && text.trim() === "AITMI_OK" };
}
