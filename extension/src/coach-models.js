// The model list, apart from coach.js so the options page can show it without
// bundling the SDK. Prices are Anthropic's list prices in USD per million
// tokens, as of 2026-10-28.
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
