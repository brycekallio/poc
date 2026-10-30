// Where the model comes from, and the model lists, apart from coach.js so the
// settings pages can show them without bundling the SDK.
//
// Only Anthropic's list is written down here, for its prices. Every other
// provider is asked what it offers (llm.js listModels), because model names
// change faster than this file would. `prefer` picks the default from that list.
//
// `kind` is how llm.js talks to it. `local` means it runs on this computer.
export const PROVIDERS = {
  ollama: {
    name: "Ollama", kind: "compat", local: true, keyless: true, baseUrl: "http://localhost:11434/v1",
    note: "Free. Runs on your computer, and your text never leaves it.",
    hide: /embed|bge-|minilm/i,
  },
  anthropic: {
    name: "Anthropic", kind: "anthropic", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-api03-…",
    note: "Claude. You pay Anthropic per use.",
  },
  openai: {
    name: "OpenAI", kind: "compat", baseUrl: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…",
    note: "GPT. You pay OpenAI per use.",
    only: /^(gpt-|o\d)/, hide: /audio|tts|transcribe|realtime|image|search|embedding|instruct/i, prefer: /mini/,
  },
  gemini: {
    name: "Google Gemini", kind: "compat", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza…",
    note: "Google's free tier covers light use.",
    only: /^gemini/, hide: /embedding|image|tts|audio|live|aqa|vision/i, prefer: /flash(?!.*lite)/,
  },
  custom: {
    name: "Other", kind: "compat", keyless: true, keyHint: "Leave empty if it needs none",
    note: "Any OpenAI-compatible server: LM Studio, OpenRouter, Groq.",
  },
};
export const DEFAULT_PROVIDER = "ollama";

/** Chat models only, newest-looking first. */
export function usableModels(provider, ids) {
  const { only, hide } = PROVIDERS[provider] ?? {};
  return ids
    .filter((id) => (!only || only.test(id)) && !hide?.test(id))
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
}

/** The default from a provider's list: its preferred kind if any, else the first. */
export function pickModel(provider, ids) {
  const { prefer } = PROVIDERS[provider] ?? {};
  return ids.find((id) => prefer?.test(id)) ?? ids[0] ?? null;
}

// Prices are Anthropic's list prices in USD per million tokens, as of 2026-10-28.
export const MODELS = [
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", input: 2.0, output: 10.0, note: "The default. Quick enough to stay out of your way." },
  { id: "claude-opus-5-5", name: "Opus 5.5", input: 4.0, output: 20.0, note: "The sharpest questions, and the slowest to arrive." },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", input: 0.1, output: 0.5, note: "Fastest and cheapest. More likely to ask generic questions.", fallback: false },
];
export const DEFAULT_MODEL = MODELS[0].id;
// `fallback: false`: no server-side safety fallback exists for that model.

// One use is both calls: call 1 (system prompt and draft in, thinking and
// questions out) and call 2 (system prompt, draft and answers in, thinking and
// the rewrite out). Rough figures for a draft of a paragraph or two; a rewrite
// that needs its one retry costs about a third more.
export const TOKENS_PER_USE = { input: 2500, output: 3500 };

/** Estimated dollars for 100 uses on this model. */
export function costPer100(model) {
  const { input, output } = TOKENS_PER_USE;
  return (100 * (input * model.input + output * model.output)) / 1e6;
}
