// The service worker (src/worker.js) with a fake `chrome`: the gate that keeps key-carrying
// messages away from web pages, and the Ollama Origin rule that is scoped to our own extension.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const EXT_URL = `chrome-extension://${EXT_ID}/`;
const listeners = {};
const ruleCalls = [];
const hook = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
globalThis.chrome = {
  runtime: { id: EXT_ID, getURL: (p) => EXT_URL + p, onMessage: hook("message"), onConnect: hook("connect"), onInstalled: hook("installed"), onStartup: hook("startup"), openOptionsPage: async () => {} },
  commands: { onCommand: hook("command") },
  storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: hook("changed") },
  action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} },
  tabs: { create: async () => {}, query: async () => [], sendMessage: async () => {} },
  scripting: { unregisterContentScripts: async () => {}, executeScript: async () => {} },
  declarativeNetRequest: { updateDynamicRules: async (r) => { ruleCalls.push(r); } },
};
await import("../src/worker.js");

// Sends a message the way Chrome does; resolves with the reply, or "ignored" when the worker
// returned false (no reply will ever come).
function send(msg, sender) {
  return new Promise((resolve) => {
    const keepOpen = listeners.message(msg, sender, resolve);
    if (!keepOpen) resolve("ignored");
  });
}

const page = { url: "https://evil.example/chat", tab: { id: 1 } };
const ownPage = { url: `${EXT_URL}options.html` };
const config = { provider: "ollama", apiKey: "", model: "m" };

for (const type of ["listModels", "checkConnection"]) {
  test(`${type} from a web page is refused; no reply, no work`, async () => {
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = async () => { fetched++; throw new Error("must not run"); };
    try {
      assert.equal(await send({ type, config }, page), "ignored");
      assert.equal(await send({ type, config }, {}), "ignored"); // no sender.url at all
      assert.equal(await send({ type, config }, { url: `https://x.example/${EXT_URL}` }), "ignored"); // prefix must be at the start
      assert.equal(fetched, 0);
    } finally { globalThis.fetch = realFetch; }
  });

  test(`${type} from the extension's own page is answered`, async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [{ name: "m" }], data: [], choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    try {
      const reply = await send({ type, config }, ownPage);
      assert.notEqual(reply, "ignored");
      assert.equal(typeof reply.ok, "boolean");
    } finally { globalThis.fetch = realFetch; }
  });
}

test("unknown message types are ignored", async () => {
  assert.equal(await send({ type: "nope" }, ownPage), "ignored");
  assert.equal(await send(undefined, ownPage), "ignored");
});

test("the Ollama Origin-strip rule only applies to requests this extension makes", async () => {
  await listeners.installed({ reason: "update" });
  const { addRules } = ruleCalls.at(-1);
  assert.equal(addRules.length, 1);
  const [rule] = addRules;
  assert.deepEqual(rule.condition.initiatorDomains, [EXT_ID]);
  assert.deepEqual(rule.action.requestHeaders, [{ header: "origin", operation: "remove" }]);
  const re = new RegExp(rule.condition.regexFilter);
  assert.ok(re.test("http://localhost:11434/api/chat"));
  assert.ok(re.test("http://127.0.0.1:11434/v1/models"));
  assert.ok(!re.test("https://api.openai.com/v1/models"));
  assert.ok(!re.test("http://localhost.evil.example/"));
});
