// The fallback beta flag goes only to model ids we ship in MODELS; a hand-typed
// id gets no beta header and no `fallbacks`. Stubbed fetch: no network, no keys.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { MODELS } from "../src/coach-models.js";
import { complete } from "../src/llm.js";

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const schema = z.object({ reader: z.enum(["ai", "person"]) });
const request = { system: "sys", messages: [{ role: "user", content: "hi" }], schema };

async function send(model) {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        id: "m", type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: '{"reader":"ai"}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  await complete({ provider: "anthropic", apiKey: "k", model }, request);
  return seen;
}

test("an unknown model id sends no fallback beta", async () => {
  const { headers, body } = await send("claude-hand-typed-1");
  assert.ok(!(headers.get("anthropic-beta") ?? "").includes("server-side-fallback"));
  assert.equal(body.fallbacks, undefined);
});

test("a known model id sends the fallback beta", async () => {
  const known = MODELS.find((m) => m.fallback !== false);
  const { headers, body } = await send(known.id);
  assert.match(headers.get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);
  assert.equal(body.fallbacks, "default");
});
