import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODELS, PROVIDERS, pickModel, usableModels } from "./coach-models.js";

// The one way anything reaches a model. Anthropic goes through its SDK. Everyone
// else (OpenAI, Gemini, Ollama, LM Studio, Groq…) speaks the same OpenAI-style
// /chat/completions, so one small fetch covers them all.
//
// A config is { provider, apiKey, baseUrl, model }. Never import this from
// content.js: it takes the API key.

/** A failure the panel knows how to explain. `code` is the stable part. */
export class CoachError extends Error {
  constructor(code, detail) {
    super(detail ?? code);
    this.code = code;
  }
}

/** One structured reply: the parsed object, shaped like `schema`. */
export function complete(config, request) {
  return kindOf(config) === "anthropic" ? anthropicComplete(config, request) : compatComplete(config, request);
}

/** The model ids this provider offers, best first where we can tell. */
export async function listModels(config) {
  if (kindOf(config) === "anthropic") return MODELS.map((m) => m.id);
  const res = await call(config, "/models");
  if (!res.ok) throw await httpError(res, config);
  const { data = [] } = await res.json();
  // Gemini answers "models/gemini-…"; requests want the bare id.
  return usableModels(config.provider, data.map((m) => String(m.id).replace(/^models\//, "")));
}

/** The cheapest call that proves a key and model work. */
export async function checkConnection(config) {
  if (kindOf(config) === "anthropic") {
    await anthropicClient(config.apiKey, { maxRetries: 0 }).messages.create({
      model: config.model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with OK." }],
    });
    return;
  }
  const res = await call(config, "/chat/completions", {
    model: config.model,
    messages: [{ role: "user", content: "Reply with OK." }],
  });
  if (!res.ok) throw await httpError(res, config);
}

/** The saved config, filled in: a local server with no model chosen gets its first. */
export async function ready(config) {
  const p = PROVIDERS[config.provider];
  if (!p) throw new CoachError("no-model");
  if (!p.keyless && !config.apiKey) throw new CoachError("no-key");
  if (config.model) return config;
  if (kindOf(config) === "anthropic") throw new CoachError("no-model");
  const model = pickModel(config.provider, await listModels(config));
  if (!model) throw new CoachError("no-model");
  return { ...config, model };
}

const kindOf = (config) => PROVIDERS[config.provider]?.kind ?? "compat";
const nameOf = (config) => PROVIDERS[config.provider]?.name ?? "the model";

// ── Anthropic ─────────────────────────────────────────────────────────

async function anthropicComplete({ apiKey, model }, { system, messages, schema }) {
  const res = await anthropicClient(apiKey).beta.messages.parse({
    model,
    max_tokens: 16000,
    system,
    messages,
    // Medium effort: the popup is open in the middle of someone's typing, and
    // waiting is part of the experience.
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    // If the safety classifier declines, retry on Anthropic's recommended
    // fallback model. A coach sees whatever topic the user is working on.
    ...(hasFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
  });
  if (res.stop_reason === "refusal") throw new CoachError("refused");
  if (res.stop_reason === "max_tokens") throw new CoachError("truncated");
  if (!res.parsed_output) throw new CoachError("unparseable");
  return res.parsed_output;
}

function anthropicClient(apiKey, { maxRetries = 1 } = {}) {
  return new Anthropic({
    apiKey,
    // Required in an extension. The flag exists to stop a developer shipping
    // their own key in a web page; this is the user's key in the user's browser.
    dangerouslyAllowBrowser: true,
    maxRetries,
  });
}

// Unknown ids (a model typed in by hand, say) get the fallback; the API is the judge.
const hasFallback = (model) => MODELS.find((m) => m.id === model)?.fallback !== false;

// ── OpenAI-style servers ──────────────────────────────────────────────

async function compatComplete(config, { system, messages, schema }) {
  const shape = z.toJSONSchema(schema);
  const chat = [{ role: "system", content: system }, ...messages];
  let res = await call(config, "/chat/completions", {
    model: config.model,
    messages: chat,
    response_format: { type: "json_schema", json_schema: { name: "reply", strict: true, schema: shape } },
  });
  // Not every server takes a schema. Ask in words and let the parse below judge.
  if (res.status === 400) {
    res = await call(config, "/chat/completions", {
      model: config.model,
      messages: [{ role: "system", content: `${system}\n\nReply with only a JSON object matching this JSON Schema, and nothing else:\n${JSON.stringify(shape)}` }, ...messages],
    });
  }
  if (!res.ok) throw await httpError(res, config);

  const choice = (await res.json()).choices?.[0];
  if (choice?.message?.refusal) throw new CoachError("refused");
  if (choice?.finish_reason === "length") throw new CoachError("truncated");
  const parsed = schema.safeParse(jsonIn(choice?.message?.content));
  if (!parsed.success) throw new CoachError("unparseable");
  return parsed.data;
}

function call(config, path, body) {
  const base = (config.baseUrl || PROVIDERS[config.provider]?.baseUrl || "").replace(/\/+$/, "");
  return fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: body && JSON.stringify(body),
  }).catch(() => {
    throw PROVIDERS[config.provider]?.local
      ? new CoachError("local-down", `${nameOf(config)} is not running. Open it, or connect a key in Settings.`)
      : new CoachError("network", `Could not reach ${nameOf(config)}.`);
  });
}

async function httpError(res, config) {
  const text = await res.text().catch(() => "");
  const name = nameOf(config);
  // Gemini answers a bad key with a 400, so read the words too.
  if (res.status === 401 || /api[ _-]?key/i.test(text)) return new CoachError("bad-key", `${name} rejected that key.`);
  if (res.status === 403) return new CoachError("forbidden", `This key cannot use that model on ${name}.`);
  if (res.status === 404) return new CoachError("bad-model", `${name} does not have that model.`);
  if (res.status === 429) return new CoachError("rate-limit", `${name} is rate limiting. Wait a moment and try again.`);
  return new CoachError("api", `${name} returned an error (${res.status}).`);
}

// Models that ignore the schema tend to wrap the JSON in prose or code fences.
function jsonIn(text = "") {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── Errors ────────────────────────────────────────────────────────────

/** Map any thrown error to a { code, message } the panel can show. */
export function describeError(err) {
  if (err instanceof CoachError) {
    const messages = {
      "no-key": "No API key yet.",
      "no-model": "No model chosen yet.",
      refused: "The model declined to coach this draft.",
      truncated: "The response was cut off. Try again.",
      unparseable: "The response came back malformed. Try again, or pick a stronger model in Settings.",
    };
    return { code: err.code, message: err.message !== err.code ? err.message : (messages[err.code] ?? err.message) };
  }
  // Most specific first. In the TS SDK APIConnectionError subclasses APIError.
  if (err instanceof Anthropic.AuthenticationError)
    return { code: "bad-key", message: "That API key was rejected." };
  if (err instanceof Anthropic.PermissionDeniedError)
    return { code: "forbidden", message: "This key cannot use that model." };
  if (err instanceof Anthropic.NotFoundError)
    return { code: "bad-model", message: "That model was not found for this key." };
  if (err instanceof Anthropic.RateLimitError)
    return { code: "rate-limit", message: "Rate limited. Wait a moment and try again." };
  if (err instanceof Anthropic.APIConnectionError)
    return { code: "network", message: "Could not reach the Anthropic API." };
  if (err instanceof Anthropic.APIError)
    return { code: "api", message: `API error ${err.status ?? ""}: ${err.message}`.trim() };
  return { code: "unknown", message: String(err?.message ?? err) };
}
