// The provider layer against a stubbed fetch: no network, no keys. Real runs
// against Ollama are in BUILD.md; OpenAI and Gemini need a key to prove.
//   npm test
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { diagnose } from "../src/coach.js";
import { pickModel, usableModels } from "../src/coach-models.js";
import { CoachError, complete, describeError, listModels, ready } from "../src/llm.js";

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const reply = (content, finish_reason = "stop") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }));
function stub(...responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init, body: init.body && JSON.parse(init.body) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next.clone();
  };
  return calls;
}
const schema = z.object({ reader: z.enum(["ai", "person"]) });
const request = { system: "sys", messages: [{ role: "user", content: "hi" }], schema };
const gemini = { provider: "gemini", apiKey: "k", model: "gemini-x" };
const ollama = { provider: "ollama", apiKey: "", model: "m" };

test("sends the schema and the key to the provider's address", async () => {
  const calls = stub(reply('{"reader":"ai"}'));
  assert.deepEqual(await complete(gemini, request), { reader: "ai" });
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer k");
  assert.equal(calls[0].body.response_format.json_schema.schema.properties.reader.enum.length, 2);
  assert.equal(calls[0].body.messages[0].role, "system");
});

test("a local server gets no authorization header", async () => {
  const calls = stub(reply('{"reader":"ai"}'));
  await complete(ollama, request);
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, undefined);
});

test("a server that refuses schemas is asked in words, and fenced JSON still parses", async () => {
  const calls = stub(new Response("no schemas here", { status: 400 }), reply('Sure!\n```json\n{"reader":"person"}\n```'));
  assert.deepEqual(await complete(ollama, request), { reader: "person" });
  assert.equal(calls[1].body.response_format, undefined);
  assert.match(calls[1].body.messages[0].content, /JSON Schema/);
});

test("Gemini's 400 for a bad key reads as a bad key", async () => {
  stub(new Response('{"error":{"message":"API key not valid"}}', { status: 400 }));
  await assert.rejects(complete(gemini, request), (e) => e.code === "bad-key");
});

for (const [status, code] of [[401, "bad-key"], [403, "forbidden"], [404, "bad-model"], [429, "rate-limit"], [500, "api"]]) {
  test(`HTTP ${status} becomes ${code}`, async () => {
    stub(new Response("nope", { status }));
    await assert.rejects(complete(gemini, request), (e) => e.code === code);
  });
}

test("cut-off and off-schema replies are named", async () => {
  stub(reply('{"reader":"ai"}', "length"));
  await assert.rejects(complete(ollama, request), (e) => e.code === "truncated");
  stub(reply('{"reader":"dog"}'));
  await assert.rejects(complete(ollama, request), (e) => e.code === "unparseable");
});

test("Ollama not running says so; a cloud provider says network", async () => {
  stub(new TypeError("fetch failed"));
  await assert.rejects(complete(ollama, request), (e) => e.code === "local-down" && /Ollama is not running/.test(describeError(e).message));
  await assert.rejects(complete(gemini, request), (e) => e.code === "network");
});

test("model lists keep chat models and pick a sensible default", async () => {
  stub(new Response(JSON.stringify({ data: [{ id: "models/gemini-9-flash-lite" }, { id: "models/gemini-9-flash" }, { id: "models/gemini-9-pro" }, { id: "models/text-embedding-4" }] })));
  const ids = await listModels({ provider: "gemini", apiKey: "k" });
  assert.deepEqual(ids, ["gemini-9-pro", "gemini-9-flash-lite", "gemini-9-flash"]);
  assert.equal(pickModel("gemini", ids), "gemini-9-flash");
  assert.deepEqual(usableModels("openai", ["gpt-9", "gpt-9-mini", "gpt-9-tts", "whisper-1", "dall-e-3"]), ["gpt-9-mini", "gpt-9"]);
  assert.equal(pickModel("openai", ["gpt-9-mini", "gpt-9"]), "gpt-9-mini");
});

test("ready(): a key is required where one is, and a local model is found", async () => {
  await assert.rejects(ready({ provider: "openai" }), (e) => e instanceof CoachError && e.code === "no-key");
  stub(new Response(JSON.stringify({ data: [{ id: "nomic-embed-text" }, { id: "qwen2.5" }] })));
  assert.equal((await ready({ provider: "ollama" })).model, "qwen2.5");
  stub(new Response(JSON.stringify({ data: [] })));
  await assert.rejects(ready({ provider: "ollama" }), (e) => e.code === "no-model");
});

test("options the panel already offers are dropped, and a question left without a choice goes", async () => {
  stub(reply(JSON.stringify({
    reader: "person", diagnosis: [],
    questions: [
      { id: "a", quote: "", question: "Which board?", options: ["Audit", "Full board", "skip"] },
      { id: "b", quote: "", question: "Really?", options: ["Yes", "Other", "Not sure"] },
    ],
  })));
  const { questions } = await diagnose({ config: ollama, draft: "x" });
  assert.deepEqual(questions.map((q) => q.options), [["Audit", "Full board"]]);
});
