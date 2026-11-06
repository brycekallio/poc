// content.js's worker link (src/bridge.js) with a fake port: partials, success, failure, disconnect.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { send, streamRewrite } from "../src/bridge.js";

function fakePort() {
  const msg = [], gone = [];
  const port = {
    sent: [], disconnected: false,
    onMessage: { addListener: (f) => msg.push(f) },
    onDisconnect: { addListener: (f) => gone.push(f) },
    postMessage(m) { port.sent.push(m); },
    disconnect() { port.disconnected = true; },
    emit: (m) => msg.forEach((f) => f(m)),
    drop: () => gone.forEach((f) => f()),
  };
  return port;
}
const withChrome = (chrome, fn) => async () => { globalThis.chrome = chrome; try { await fn(); } finally { delete globalThis.chrome; } };
const rejection = (p) => p.then(() => assert.fail("should reject"), (e) => e);

test("streamRewrite: partials reach onPartial, then ok resolves with the whole message", withChrome(
  { runtime: { connect: (o) => { assert.deepEqual(o, { name: "rewrite" }); return (globalThis.port = fakePort()); } } },
  async () => {
    const seen = [];
    const p = streamRewrite({ draft: "d" }, (t) => seen.push(t));
    const port = globalThis.port;
    assert.deepEqual(port.sent, [{ draft: "d" }]);
    port.emit({ partial: "Wri" });
    port.emit({ partial: "Write a" });
    port.emit({ ok: true, prompt: "Write a plan.", techniques: ["x"], unverified: [] });
    assert.deepEqual(await p, { ok: true, prompt: "Write a plan.", techniques: ["x"], unverified: [] });
    assert.deepEqual(seen, ["Wri", "Write a"]);
    assert.ok(port.disconnected);
    port.drop(); // Chrome fires onDisconnect after our own disconnect: must not matter
  }));

test("streamRewrite: a partial without onPartial is fine", withChrome(
  { runtime: { connect: () => (globalThis.port = fakePort()) } },
  async () => {
    const p = streamRewrite({});
    globalThis.port.emit({ partial: "x" });
    globalThis.port.emit({ ok: true, prompt: "p" });
    assert.equal((await p).prompt, "p");
  }));

test("streamRewrite: ok:false rejects with the worker's error, or a generic one", withChrome(
  { runtime: { connect: () => (globalThis.port = fakePort()) } },
  async () => {
    let p = streamRewrite({});
    globalThis.port.emit({ ok: false, error: { code: "auth", message: "Bad key." } });
    assert.deepEqual(await rejection(p), { code: "auth", message: "Bad key." });
    p = streamRewrite({});
    globalThis.port.emit({ ok: false });
    assert.deepEqual(await rejection(p), { code: "unknown", message: "Something went wrong." });
  }));

test("streamRewrite: a drop before any result rejects as dropped; after a result it is ignored", withChrome(
  { runtime: { connect: () => (globalThis.port = fakePort()) } },
  async () => {
    let p = streamRewrite({});
    globalThis.port.drop();
    const err = await rejection(p);
    assert.equal(err.code, "orphaned");
    assert.match(err.message, /dropped/);
    p = streamRewrite({});
    globalThis.port.emit({ ok: true, prompt: "p" });
    globalThis.port.drop();
    assert.equal((await p).prompt, "p");
  }));

test("streamRewrite: connect throwing (extension reloaded) rejects as orphaned, never throws", withChrome(
  { runtime: { connect: () => { throw new Error("Extension context invalidated."); } } },
  async () => {
    assert.deepEqual(await rejection(streamRewrite({})), { code: "orphaned", message: "P.O.C was updated. Reload this page to use it." });
  }));

test("send: returns the reply when ok; throws the worker's error otherwise", async () => {
  const reply = (r) => ({ runtime: { sendMessage: async () => r } });
  globalThis.chrome = reply({ ok: true, questions: [] });
  assert.deepEqual(await send({}), { ok: true, questions: [] });
  globalThis.chrome = reply({ ok: false, error: { code: "net", message: "Offline." } });
  assert.deepEqual(await rejection(send({})), { code: "net", message: "Offline." });
  globalThis.chrome = reply(undefined);
  assert.deepEqual(await rejection(send({})), { code: "unknown", message: "Something went wrong." });
  globalThis.chrome = { runtime: { sendMessage: async () => { throw new Error("gone"); } } };
  assert.equal((await rejection(send({}))).code, "orphaned");
  delete globalThis.chrome;
});
