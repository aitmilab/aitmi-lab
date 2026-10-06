import test from "node:test";
import assert from "node:assert/strict";
import { createProfile, profileView, validateConnection } from "../src/profile.mjs";

test("Lab begins with no provider connection", () => {
  assert.deepEqual(createProfile(), { version: 1, connections: [] });
  assert.deepEqual(profileView(createProfile()), []);
});

test("Lab connection records cannot carry a credential or identity", () => {
  assert.equal(validateConnection({ provider: "chatgpt", state: "awaiting-user" }), true);
  assert.equal(validateConnection({ provider: "chatgpt", state: "connected", token: "secret" }), false);
  assert.equal(validateConnection({ provider: "chatgpt", state: "connected", account: "person@example.test" }), false);
});
