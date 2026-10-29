// The model list, apart from coach.js so the options page can show it without
// bundling the SDK. Prices are Anthropic's list prices in USD per million
// tokens, as of 2026-10-28.
export const MODELS = [
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", input: 2.0, output: 10.0, note: "The default. Quick enough to stay out of your way." },
  { id: "claude-opus-5-5", name: "Opus 5.5", input: 4.0, output: 20.0, note: "The sharpest questions, and the slowest to arrive." },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", input: 0.1, output: 0.5, note: "Fastest and cheapest. More likely to ask generic questions." },
];
export const DEFAULT_MODEL = MODELS[0].id;

// One summon is call 1: the system prompt plus a draft in, thinking plus the
// questions out. Rough figures for a draft of a paragraph or two.
export const TOKENS_PER_SUMMON = { input: 1000, output: 1500 };

/** Estimated dollars for 100 summons on this model. */
export function costPer100(model) {
  const { input, output } = TOKENS_PER_SUMMON;
  return (100 * (input * model.input + output * model.output)) / 1e6;
}
