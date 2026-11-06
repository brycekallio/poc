// The Mac app's engine (src/desktop.js) against a stubbed model server: the two calls, the error
// states the card has to explain, and the rule that it stays free of Chrome. No network, no keys.
//   npm test
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { diagnoseDraft, rewriteDraft, cancel } from "../src/desktop.js";

const realFetch = globalThis.fetch;
afterEach(() => { cancel(); globalThis.fetch = realFetch; });

const draft = "write a summary of the q3 report for the team";
const ollama = { provider: "ollama", apiKey: "", model: "m" };
const chat = (obj) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: "stop" }] }));
const diagnosis = {
  reader: "ai", diagnosis: ["no length"],
  questions: [{ id: "length", quote: "summary", question: "How long?", options: ["One page", "Three bullets", "Skip"] }],
};
const rewritten = {
  prompt: "Write a one-page summary of the Q3 report for the team.",
  techniques: [{ id: "deliverable", evidence: "one-page summary" }],
};
function stub(...responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), signal: init?.signal, body: init?.body && JSON.parse(init.body) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (typeof next === "function") return next(init);
    if (next instanceof Error) throw next;
    return next.clone();
  };
  return calls;
}

test("call 1 returns the reader and the questions, and keeps the diagnosis internal", async () => {
  stub(chat(diagnosis));
  const out = await diagnoseDraft({ config: ollama, draft, host: "Claude, an AI chat app" });
  assert.equal(out.ok, true);
  assert.equal(out.reader, "ai");
  assert.deepEqual(out.questions[0].options, ["One page", "Three bullets"]); // "Skip" is the panel's, not the model's
  assert.equal("diagnosis" in out, false);
});

test("the host name reaches the model, and the draft is fenced as material", async () => {
  const calls = stub(chat(diagnosis));
  await diagnoseDraft({ config: ollama, draft, host: "T3 Code, an AI chat app" });
  const user = calls[0].body.messages.at(-1).content;
  assert.match(user, /T3 Code, an AI chat app/);
  assert.match(user, /<draft>\nwrite a summary/);
});

test("call 2 returns the rewrite and its techniques, from the answers", async () => {
  const calls = stub(chat(rewritten));
  const out = await rewriteDraft({
    config: ollama, draft, host: "Claude, an AI chat app", reader: "ai",
    answers: [{ question: "How long?", answer: "One page" }, { question: "Who for?", answer: null }],
  });
  assert.equal(out.ok, true);
  assert.equal(out.prompt, "Write a one-page summary of the Q3 report for the team.");
  assert.deepEqual(out.techniques, ["Clear deliverable"]);
  assert.deepEqual(out.unverified, []);
  const user = calls[0].body.messages.at(-1).content;
  assert.match(user, /A: One page/);
  assert.match(user, /\(skipped/);
});

test("the key goes to the provider and never comes back in a reply", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(init.headers); return chat(diagnosis); };
  const out = await diagnoseDraft({ config: { provider: "openai", apiKey: "sk-secret", model: "gpt-x" }, draft, host: "x" });
  assert.equal(calls[0].authorization, "Bearer sk-secret");
  assert.equal(JSON.stringify(out).includes("sk-secret"), false);
});

test("no key: a hosted provider without one fails before any request", async () => {
  const calls = stub(chat(diagnosis));
  const out = await diagnoseDraft({ config: { provider: "anthropic", apiKey: "", model: "claude-sonnet-5-5" }, draft, host: "x" });
  assert.deepEqual(out, { ok: false, error: { code: "no-key", message: "No API key yet." } });
  assert.equal(calls.length, 0);
});

test("a local model with none chosen takes the first one the server lists", async () => {
  const calls = stub(new Response(JSON.stringify({ data: [{ id: "qwen2.5:latest" }, { id: "nomic-embed-text" }] })), chat(diagnosis));
  const out = await diagnoseDraft({ config: { provider: "ollama", apiKey: "", model: "" }, draft, host: "x" });
  assert.equal(out.ok, true);
  assert.equal(calls[1].body.model, "qwen2.5:latest");
});

test("model error: an unknown model is bad-model, a rejected key is bad-key", async () => {
  stub(new Response("nope", { status: 404 }));
  assert.equal((await diagnoseDraft({ config: ollama, draft, host: "x" })).error.code, "bad-model");
  stub(new Response("nope", { status: 401 }));
  assert.equal((await diagnoseDraft({ config: ollama, draft, host: "x" })).error.code, "bad-key");
});

test("model error: garbage instead of JSON is unparseable, with words the card can show", async () => {
  stub(new Response(JSON.stringify({ choices: [{ message: { content: "I cannot do that." }, finish_reason: "stop" }] })));
  const out = await diagnoseDraft({ config: ollama, draft, host: "x" });
  assert.equal(out.error.code, "unparseable");
  assert.match(out.error.message, /malformed/);
});

test("Ollama not running reads as local-down", async () => {
  stub(new TypeError("fetch failed"));
  const out = await diagnoseDraft({ config: ollama, draft, host: "x" });
  assert.equal(out.error.code, "local-down");
  assert.match(out.error.message, /Ollama is not running/);
});

test("timeout: a server that never answers is cut off, and the request is really aborted", async () => {
  const calls = stub((init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
  const out = await diagnoseDraft({ config: ollama, draft, host: "x", timeoutMs: 40 });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "timeout");
  assert.match(out.error.message, /took longer than/);
  assert.equal(calls[0].signal.aborted, true);
});

test("closing the card cancels the call, quietly", async () => {
  stub((init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
  const pending = diagnoseDraft({ config: ollama, draft, host: "x" });
  setTimeout(cancel, 10);
  assert.equal((await pending).error.code, "cancelled");
});

test("a rewrite that fails its checks gets one retry; if it still fails it is returned, marked unverified", async () => {
  const shouting = { prompt: "Write a SUMMARY of the Q3 report for the team.", techniques: [{ id: "deliverable", evidence: "summary of the q3 report" }] };
  const calls = stub(chat(shouting));
  const out = await rewriteDraft({ config: ollama, draft, host: "x", reader: "ai", answers: [] });
  assert.equal(out.ok, true);
  assert.equal(calls.length, 2);
  assert.match(out.unverified.join(" "), /ALL-CAPS/);
});

test("the rewrite streams its text so far", async () => {
  const json = JSON.stringify(rewritten);
  const sse = (piece) => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`;
  globalThis.fetch = async () => new Response(sse(json.slice(0, 30)) + sse(json.slice(30)) + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  const seen = [];
  const out = await rewriteDraft({ config: ollama, draft, host: "x", reader: "ai", answers: [] }, (t) => seen.push(t));
  assert.equal(out.ok, true);
  assert.ok(seen.length >= 1);
  assert.match(seen.at(-1), /^Write a one-page summary/);
});

test("drift guard: the engine imports nothing from the Chrome side", () => {
  const src = readFileSync(new URL("../src/desktop.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from\s+["']\.\/(content|worker|popup|options|setup|settings)\.js["']/);
  assert.doesNotMatch(src, /\bchrome\./);
  // and nothing it pulls in reaches Chrome either
  for (const f of ["coach.js", "llm.js", "coach-models.js", "partial-json.js"]) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"), /\bchrome\.(storage|runtime|tabs)/, f);
  }
});

test("reply shapes: call 1 is { ok, reader, questions }; call 2 carries the rewrite and no diagnosis or key", async () => {
  stub(chat(diagnosis));
  assert.deepEqual(Object.keys(await diagnoseDraft({ config: ollama, draft, host: "x" })).sort(), ["ok", "questions", "reader"]);
  stub(chat(rewritten));
  const out = await rewriteDraft({ config: { ...ollama, apiKey: "sk-secret" }, draft, host: "x", reader: "ai", answers: [] });
  for (const k of ["ok", "prompt", "techniques", "unverified"]) assert.ok(k in out, k);
  assert.ok(!("diagnosis" in out) && !("config" in out) && !("apiKey" in out));
  assert.ok(!JSON.stringify(out).includes("sk-secret"));
});

test("OpenAI goes through the native bridge (its replies carry no CORS headers); other hosts do not", async () => {
  const sent = [];
  globalThis.webkit = { messageHandlers: { net: { postMessage: async (m) => { sent.push(m); return { status: 401, headers: { "content-type": "application/json" }, body: "{}" }; } } } };
  try {
    stub(chat(diagnosis));
    const out = await diagnoseDraft({ config: { provider: "openai", apiKey: "sk-x", model: "m" }, draft, host: "Claude, an AI chat app" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(out.error.code, "bad-key"); // the 401 is readable
    const calls = stub(chat(diagnosis));
    await diagnoseDraft({ config: { provider: "ollama", apiKey: "", model: "m" }, draft, host: "Claude, an AI chat app" });
    assert.equal(sent.length, 1); // local server: plain fetch
    assert.equal(calls.length, 1);
  } finally { delete globalThis.webkit; }
});

test("aborting a native OpenAI call tells Swift to cancel that request", async () => {
  const sent = [];
  globalThis.webkit = { messageHandlers: { net: { postMessage: (m) => { sent.push(m); return new Promise(() => {}); } } } }; // never answers
  try {
    const run = diagnoseDraft({ config: { provider: "openai", apiKey: "sk-x", model: "m" }, draft, host: "Claude, an AI chat app", timeoutMs: 50 });
    const out = await run;
    assert.equal(out.error.code, "timeout");
    assert.equal(sent.length, 2);
    assert.equal(sent[1].cancel, sent[0].id);
  } finally { delete globalThis.webkit; }
});
