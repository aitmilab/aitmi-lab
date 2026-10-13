import { validateManifest } from "./manifest.mjs";

// Declarative UI packages only. Validation grants neither host authority nor
// privacy clearance. A Core host must approve capabilities and apply policy
// before rendering content or executing a command. No code runs in the host.
const SCHEMA = "aitmi-lab-ui/v1";
const MAX_BYTES = 65536;
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const id = value => typeof value === "string" && /^[a-z][a-z0-9-]{1,47}$/.test(value) && !forbidden.has(value);
const text = (value, max, multiline = false) => typeof value === "string" && value.trim().length > 0 && value.length <= max &&
  !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/ : /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/).test(value);
const list = (value, max) => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max && Reflect.ownKeys(value).length === value.length + 1 &&
  Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index))).every(item => item && "value" in item && item.enumerable);
function record(value, fields) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== fields.length) return false;
  return fields.every(field => { const own = Object.getOwnPropertyDescriptor(value, field); return own && own.enumerable && "value" in own; });
}
function manifest(value) {
  if (!record(value, ["version", "id", "name", "entry", "capabilities"]) || !list(value.capabilities, 3) || !validateManifest(value)) return null;
  return Object.freeze({ version: 1, id: value.id, name: value.name, entry: "index.mjs", capabilities: Object.freeze([...value.capabilities]) });
}
function contribution(value) {
  if (!value || typeof value !== "object") return null;
  const kind = Object.getOwnPropertyDescriptor(value, "type");
  if (!kind || !("value" in kind)) return null;
  switch (kind.value) {
    case "panel":
      if (!record(value, ["type", "id", "title", "text"]) || !id(value.id) || !text(value.title, 80) || !text(value.text, 4096, true)) return null;
      return Object.freeze({ type: "panel", id: value.id, title: value.title, text: value.text });
    case "command":
      // Commands invoke declared Core actions, never extension JavaScript,
      // provider routes, arbitrary files or a system shell.
      if (!record(value, ["type", "id", "label", "action", "capabilities"]) || !id(value.id) || !text(value.label, 80) ||
        !["check-compose", "protect-copy"].includes(value.action) || !list(value.capabilities, 1) || value.capabilities[0] !== "protected-input") return null;
      return Object.freeze({ type: "command", id: value.id, label: value.label, action: value.action, capabilities: Object.freeze(["protected-input"]) });
    case "status":
      // Extension-reported state only. There is no host/privacy/provider
      // status field, arbitrary badge label, icon, colour or style.
      if (!record(value, ["type", "id", "state"]) || !id(value.id) || !["idle", "busy", "ready", "unavailable"].includes(value.state)) return null;
      return Object.freeze({ type: "status", id: value.id, state: value.state });
    case "artifact": {
      if (!record(value, ["type", "id", "title", "format", "content"]) || !id(value.id) || !text(value.title, 80)) return null;
      if (value.format === "text" && text(value.content, 8192, true)) return Object.freeze({ type: "artifact", id: value.id, title: value.title, format: "text", content: value.content });
      if (value.format !== "table" || !list(value.content, 20) || value.content.length === 0) return null;
      const width = value.content[0]?.length;
      if (!Number.isInteger(width) || width < 1 || width > 10 || !value.content.every(row => list(row, 10) && row.length === width && row.every(cell => text(cell, 256)))) return null;
      return Object.freeze({ type: "artifact", id: value.id, title: value.title, format: "table", content: Object.freeze(value.content.map(row => Object.freeze([...row]))) });
    }
    case "terminal-output":
      // Structured metadata, not raw stdout, prompts, answers or ANSI.
      if (!record(value, ["type", "id", "phase", "count"]) || !id(value.id) || !["started", "completed", "refused", "unavailable"].includes(value.phase) ||
        !(value.count === null || Number.isSafeInteger(value.count) && value.count >= 0 && value.count <= 1000000)) return null;
      return Object.freeze({ type: "terminal-output", id: value.id, phase: value.phase, count: value.count });
    default: return null;
  }
}

/** Closed, bounded, immutable package parser. No rendering or execution. */
export function parseUiPackage(value) {
  try {
    if (typeof value === "string") {
      if (value.length > MAX_BYTES || new TextEncoder().encode(value).length > MAX_BYTES) return null;
      value = JSON.parse(value);
    }
    if (!record(value, ["schema", "manifest", "contributions"]) || value.schema !== SCHEMA || !list(value.contributions, 20)) return null;
    const owner = manifest(value.manifest);
    if (!owner) return null;
    const items = value.contributions.map(contribution);
    if (items.some(item => !item) || new Set(items.map(item => item.id)).size !== items.length) return null;
    if (items.some(item => item.type === "command" && item.capabilities.some(capability => !owner.capabilities.includes(capability)))) return null;
    const parsed = Object.freeze({ schema: SCHEMA, manifest: owner, contributions: Object.freeze(items) });
    return new TextEncoder().encode(JSON.stringify(parsed)).length <= MAX_BYTES ? parsed : null;
  } catch { return null; }
}

/** aitmi.ui builders produce a package; they do not send data or grant rights. */
export function createUi(value) {
  let owner;
  try { owner = manifest(value); } catch { /* Fixed failure below. */ }
  if (!owner) throw new Error("Invalid UI manifest.");
  const items = [];
  const add = (type, value) => {
    let item;
    try {
      // Only plain data descriptors are accepted, before a spread can read
      // accessors or a caller can smuggle a replacement type.
      if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return typeof key === "string" && key !== "type" && descriptor?.enumerable && "value" in descriptor;
      })) item = contribution({ type, ...value });
    } catch { /* No caller material enters the error. */ }
    if (!item || items.length >= 20 || items.some(existing => existing.id === item.id) || item.type === "command" && !owner.capabilities.includes("protected-input")) throw new Error("Invalid UI contribution.");
    const next = parseUiPackage({ schema: SCHEMA, manifest: owner, contributions: [...items, item] });
    if (!next) throw new Error("UI package limit exceeded.");
    items.push(item);
    return item;
  };
  return Object.freeze({
    panel: value => add("panel", value), command: value => add("command", value), status: value => add("status", value),
    artifact: value => add("artifact", value), terminalOutput: value => add("terminal-output", value),
    package: () => parseUiPackage({ schema: SCHEMA, manifest: owner, contributions: items }),
  });
}
