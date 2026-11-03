// Time both model calls end to end and say where the seconds go.
//
//   npm run time -- --provider ollama --model qwen2.5:latest
//   ANTHROPIC_API_KEY=… npm run time -- --provider anthropic --model claude-sonnet-5-5
//
// Wraps fetch to log each HTTP request's wall time and the token counts the
// server reports, so "slow" can be split into prompt reading (input tokens) and
// writing (output tokens). Runs the fixed draft below three times by default.
import { diagnose, ready, rewrite } from "../src/coach.js";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args.splice(i, 2)[1]; };
const provider = flag("--provider", "ollama");
const model = flag("--model", "");
const runs = Number(flag("--runs", 3));
const apiKey = process.env.API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";

const DRAFT = "write a summary of the q3 report for the team, make it good and not too long";
const HOST = "Claude, an AI chat site";

const realFetch = globalThis.fetch;
let log = [];
globalThis.fetch = async (url, init) => {
  const t = performance.now();
  const res = await realFetch(url, init);
  // A streamed reply must reach the caller as it arrives, so only a plain JSON
  // reply is read here (for its token counts).
  if (res.headers.get("content-type")?.includes("event-stream")) {
    log.push({ url: String(url).split("/").slice(-1)[0] + " (streamed)", s: 0 });
    return res;
  }
  const clone = res.clone();
  await clone.text().then((txt) => {
    let usage = {};
    try { usage = JSON.parse(txt).usage ?? {}; } catch {}
    log.push({ url: String(url).split("/").slice(-1)[0], s: (performance.now() - t) / 1000, in: usage.prompt_tokens ?? usage.input_tokens, out: usage.completion_tokens ?? usage.output_tokens });
  });
  return res;
};

const config = await ready({ provider, model, apiKey });
console.log(`provider ${provider}, model ${config.model}\n`);
const totals = [];
for (let i = 0; i < runs; i++) {
  log = [];
  const t0 = performance.now();
  const d = await diagnose({ config, draft: DRAFT, host: HOST });
  const t1 = performance.now();
  const answers = d.questions.map((q) => ({ question: q.question, answer: q.options[0] }));
  let firstWords = null;
  const r = await rewrite({ config, draft: DRAFT, answers, host: HOST, reader: d.reader, onPartial: (p) => { if (p && firstWords === null) firstWords = (performance.now() - t1) / 1000; } });
  const t2 = performance.now();
  const c1 = (t1 - t0) / 1000, c2 = (t2 - t1) / 1000;
  totals.push([c1, c2]);
  console.log(`run ${i + 1}: call 1 ${c1.toFixed(1)}s (${d.questions.length} questions) · call 2 ${c2.toFixed(1)}s${firstWords === null ? "" : ` (first words after ${firstWords.toFixed(1)}s)`}${r.unverified.length ? " (checks failed: " + r.unverified.length + ")" : ""}`);
  for (const l of log) console.log(`    ${l.url}: ${l.s.toFixed(1)}s, ${l.in ?? "?"} tokens in, ${l.out ?? "?"} out`);
}
const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`\nmedian: call 1 ${med(totals.map((t) => t[0])).toFixed(1)}s · call 2 ${med(totals.map((t) => t[1])).toFixed(1)}s · total ${med(totals.map((t) => t[0] + t[1])).toFixed(1)}s`);
