import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createDesktopBrowser } from "../src/desktop-browser.mjs";

test("desktop browser launch requires a matching native acknowledgement", async () => {
  const channel = new EventEmitter(); channel.connected = true;
  let sent;
  channel.send = (value, done) => { sent = value; done(null); };
  const browser = createDesktopBrowser(channel, 1000);
  try {
    let complete = false;
    const pending = browser.open("synthetic-authorization-url").then(() => { complete = true; });
    channel.emit("message", { kind: "lab-provider-browser-result", id: "wrong", ok: true });
    assert.equal(complete, false);
    channel.emit("message", { kind: "lab-provider-browser-result", id: sent.id, ok: true });
    await pending; assert.equal(complete, true);
    const failed = browser.open("synthetic-authorization-url");
    channel.emit("message", { kind: "lab-provider-browser-result", id: sent.id, ok: false });
    await assert.rejects(failed, /browser-unavailable/);
  } finally { browser.close(); }
});
test("desktop browser timeout and disconnect do not claim a launched browser", async () => {
  const channel = new EventEmitter(); channel.connected = true; channel.send = (_value, done) => done(null);
  const browser = createDesktopBrowser(channel, 10);
  await assert.rejects(browser.open("synthetic"), /browser-unavailable/);
  const pending = browser.open("synthetic"); browser.close();
  await assert.rejects(pending, /browser-unavailable/);
  assert.equal(channel.listenerCount("message"), 0);
});
