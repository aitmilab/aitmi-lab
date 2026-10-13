import test from "node:test";
import assert from "node:assert/strict";
import { createUi, parseUiPackage } from "../src/ui.mjs";
const manifest = { version: 1, id: "aitmi-lab.example", name: "example", entry: "index.mjs", capabilities: ["protected-input"] };
test("all five controlled surfaces build immutable namespaced packages without host authority", () => {
  const aitmi = { ui: createUi(manifest) };
  aitmi.ui.panel({ id: "overview", title: "Overview", text: "Invented extension content." });
  aitmi.ui.command({ id: "check", label: "Check selection", action: "check-compose", capabilities: ["protected-input"] });
  aitmi.ui.status({ id: "progress", state: "idle" });
  aitmi.ui.artifact({ id: "report", title: "Report", format: "table", content: [["Item", "Count"], ["Example", "1"]] });
  aitmi.ui.terminalOutput({ id: "run", phase: "completed", count: 1 });
  const result = aitmi.ui.package();
  assert.equal(result.schema, "aitmi-lab-ui/v1");
  assert.deepEqual(result.contributions.map(item => item.type), ["panel", "command", "status", "artifact", "terminal-output"]);
  assert.deepEqual(parseUiPackage(JSON.stringify(result)), result);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.contributions[3].content[0]));
  manifest.capabilities.push("vault");
  assert.deepEqual(result.manifest.capabilities, ["protected-input"]);
  manifest.capabilities.pop();
});
test("undeclared commands, host impersonation fields and escape controls fail closed", () => {
  const ui = createUi({ ...manifest, capabilities: [] });
  assert.throws(() => ui.command({ id: "check", label: "Check", action: "check-compose", capabilities: ["protected-input"] }), /Invalid UI contribution/);
  for (const input of [
    { id: "escape", phase: "completed", count: 1, text: "\x1b[2J" },
    { id: "secret", phase: "completed", count: 1, prompt: "SYNTHETIC_PRIVATE" },
    { id: "host", phase: "protected", count: 1 },
  ]) assert.throws(() => ui.terminalOutput(input));
  assert.throws(() => ui.status({ id: "host", state: "protected" }));
  assert.throws(() => ui.status({ id: "host", state: "ready", security: true }));
  assert.throws(() => ui.panel({ id: "panel", title: "\u202ePrivacy", text: "Example" }));
  assert.throws(() => ui.panel({ id: "panel", title: "Title", text: "\x1b[2J" }));
  for (const control of ["\x80", "\x9b", "\x9f"]) {
    assert.throws(() => ui.panel({ id: "panel", title: "Title", text: `Text${control}hidden` }));
    assert.throws(() => ui.artifact({ id: "artifact", title: "Title", format: "text", content: `Text${control}hidden` }));
  }
  const privileged = createUi(manifest);
  assert.throws(() => privileged.command({ id: "shell", label: "Shell", action: "exec", capabilities: ["protected-input"] }));
});
test("hostile descriptors, malformed tables, duplicate IDs and package limits are rejected without invoking accessors", () => {
  let accessed = false;
  const ui = createUi(manifest);
  assert.throws(() => ui.panel({ id: "panel", title: "Title", get text() { accessed = true; return "private"; } }));
  assert.equal(accessed, false);
  ui.panel({ id: "panel", title: "Title", text: "<script>Text, not host markup</script>" });
  assert.throws(() => ui.status({ id: "panel", state: "ready" }));
  assert.throws(() => ui.artifact({ id: "table", title: "Table", format: "table", content: [["A", "B"], ["C"]] }));
  const valid = ui.package();
  for (const bad of [{ ...valid, vault: "SYNTHETIC_PRIVATE" }, { ...valid, contributions: Array(21).fill(valid.contributions[0]) }, Object.create(valid)]) assert.equal(parseUiPackage(bad), null);
  assert.equal(parseUiPackage("x".repeat(65537)), null);
  const inheritedArray = [...valid.contributions];
  Object.setPrototypeOf(inheritedArray, { get [Symbol.iterator]() { accessed = true; throw new Error("not evaluated"); } });
  assert.equal(parseUiPackage({ ...valid, contributions: inheritedArray }), null);
  assert.equal(accessed, false);
  const unicode = createUi(manifest);
  unicode.artifact({ id: "first", title: "Text", format: "text", content: "字".repeat(8192) });
  unicode.artifact({ id: "second", title: "Text", format: "text", content: "字".repeat(8192) });
  assert.throws(() => unicode.artifact({ id: "third", title: "Text", format: "text", content: "字".repeat(8192) }), /limit exceeded/);
  assert.equal(unicode.package().contributions.length, 2);
  const many = createUi(manifest);
  for (let index = 0; index < 20; index++) many.status({ id: `status-${index}`, state: "idle" });
  assert.throws(() => many.status({ id: "too-many", state: "idle" }));
  assert.equal(many.package().contributions.length, 20);
});
