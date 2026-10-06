import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { profileView } from "../src/profile.mjs";
import { validateManifest } from "../src/manifest.mjs";
test("malformed or credential-bearing status is rejected", () => {
  assert.deepEqual(profileView({ connections: [null, { provider: "secret", state: "connected" }, { provider: "chatgpt", state: "connected", token: "private" }] }), []);
});
test("tools cannot declare credential, arbitrary path or private history capabilities", () => {
  const tool = { version: 1, id: "aitmi-lab.example", name: "example", entry: "index.mjs", capabilities: [] };
  assert.equal(validateManifest(tool), true);
  for (const capability of ["credentials", "vault", "private-history"]) assert.equal(validateManifest({ ...tool, capabilities: [capability] }), false);
  assert.equal(validateManifest({ ...tool, entry: "../core/index.mjs" }), false);
});
test("standalone package uses only built-in or sibling imports", async () => {
  const directory = new URL("../src/", import.meta.url);
  for (const file of await readdir(directory)) {
    const source = await readFile(new URL(file, directory), "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) assert.match(match[1], /^(node:|\.\/)/);
  }
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.license, "Apache-2.0"); assert.equal(pkg.dependencies, undefined);
  assert.match(await readFile(new URL("../LICENSE", import.meta.url), "utf8"), /Apache License/);
  assert.deepEqual(pkg.files, ["src", "README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "RELEASE.md", "LICENSE", "NOTICE", "SECURITY.md"]);
  assert.match(await readFile(new URL("../NOTICE", import.meta.url), "utf8"), /AI\.TMI Core and the enclosing monorepo are not licensed/);
  assert.match(await readFile(new URL("../RELEASE.md", import.meta.url), "utf8"), /No parent workspace, Core, Vault, privacy engine or customer data is required/);
});
