// Score rewrite quality against local Ollama. See eval/rubric.md.
//
//   npm run eval -- --model qwen2.5:latest --judge hermes3:8b --seeds 1,2 --label baseline
//   flags: --temp 0.5  --only code-sql,vague-1  --fresh (ignore the call-1 cache)
//
// Per prompt and seed: call 1 (questions) -> canned answers (first option) -> call 2
// (rewrite) -> hard checks + a judge from a different model. Appends a summary to
// eval/results/<label>.json and prints it. Local Ollama only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGNOSE_SYSTEM, diagnose, rewrite } from "../src/coach.js";

const here = dirname(fileURLToPath(import.meta.url));
const evalDir = join(here, "..", "eval");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args.splice(i, 2)[1]; };
const has = (n) => { const i = args.indexOf(n); if (i === -1) return false; args.splice(i, 1); return true; };
const model = flag("--model", "qwen2.5:latest");
const judgeModel = flag("--judge", model.startsWith("hermes3") ? "qwen2.5:latest" : "hermes3:8b");
const seeds = flag("--seeds", "1,2").split(",").map(Number);
const temp = flag("--temp", undefined);
const label = flag("--label", "run");
const only = flag("--only", "")?.split(",").filter(Boolean);
const fresh = has("--fresh");
const BASE = flag("--url", "http://localhost:11434");
if (judgeModel === model) throw new Error("The judge must be a different model from the one under test.");

const prompts = JSON.parse(readFileSync(join(evalDir, "prompts.json"), "utf8")).filter((p) => !only.length || only.includes(p.id));
const cacheDir = join(evalDir, ".cache");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(join(evalDir, "results"), { recursive: true });

// ── hard checks ───────────────────────────────────────────────────────
const words = (t) => t.split(/\s+/).filter(Boolean);
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9% ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set("the and for with that this from your you are was were have has had not but can will would should could about into than then them they their what when where which while also just like want need make some more most very".split(" "));
const content = (t) => norm(t).split(" ").filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.slice(0, 5));

export function hardChecks({ draft, keep, answers, out }) {
  const r = out.prompt.trim();
  const rn = norm(r), dn = norm(draft);
  const f = {};
  f.nonempty = words(r).length >= 4;
  f.no_refusal = !/^(i'?m sorry|i am sorry|i can'?t|i cannot|as an ai|unfortunately)/i.test(r) || /^(i'?m sorry|i can'?t)/i.test(draft);
  const dw = new Set(dn.split(" ")), rw = rn.split(" ");
  const overlap = rw.filter((w) => dw.has(w)).length / Math.max(rw.length, 1);
  f.changed = rn !== dn && !(overlap > 0.95 && words(r).length <= words(draft).length + 2);
  f.intent = keep.every((k) => k.split("|").some((alt) => rn.includes(norm(alt))));
  f.no_chatter = !(/^\W*(here(?:'s| is| are)|sure|certainly|of course|okay|ok,|rewritten (prompt|message)|revised|i'?ve (rewritten|revised))/i.test(r)
    || /(let me know if|feel free to|hope this helps|i hope this)[^]*$/i.test(r.slice(-160)) && !/let me know|feel free/i.test(draft)
    || /^```/.test(r) || /^["“].*["”]$/s.test(r));
  const maxWords = Math.min(380, Math.max(90, 3 * words(draft).length + 50));
  f.length = words(r).length <= maxWords;
  const used = answers.filter((a) => a.answer);
  if (used.length) {
    const hit = used.filter((a) => {
      const c = [...new Set(content(a.answer))];
      return c.length === 0 || c.filter((w) => rn.split(" ").some((x) => x.startsWith(w))).length / c.length >= 0.5;
    }).length;
    f.uses_answers = hit / used.length >= 0.6;
  } else f.uses_answers = true;
  f.internal = out.unverified.length === 0;
  return f;
}

// ── judge ─────────────────────────────────────────────────────────────
const JUDGE_SYSTEM = `You grade a rewritten text. A user drafted something, answered clarifying questions, and an assistant rewrote it. Grade ONLY the rewrite, strictly, 1 to 5:
5 = ready to send: keeps every fact from the draft, clearly uses the answers, reads like the user wrote it with more time, states a concrete ask or point, invents nothing, no filler.
4 = good: one small flaw (a bit wordy, one answer weakly used, slightly generic).
3 = usable with editing: ignores an answer, or generic template wording, but same ask.
2 = weak: loses facts, invents requirements/audience/facts, or becomes a headed template for a simple ask.
1 = unusable: wrong task, answers the draft instead of rewriting it, refusal, or gibberish.
Be harsh: most rewrites are 3 or 4. Reply with JSON only: {"reason": "<one short sentence>", "invented": <true|false>, "score": <1-5>}`;

async function judge({ draft, answers, rewrite: text, reader }) {
  const ans = answers.map((a) => `Q: ${a.question}\nA: ${a.answer ?? "(skipped)"}`).join("\n");
  const user = `The text is a ${reader === "person" ? "message for people" : "prompt for an AI assistant"}.\n\n<draft>\n${draft}\n</draft>\n\n<answers>\n${ans || "(none)"}\n</answers>\n\n<rewrite>\n${text}\n</rewrite>`;
  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      body: JSON.stringify({ model: judgeModel, stream: false, format: "json", options: { temperature: 0, seed: 7 },
        messages: [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: user }] }),
    });
    try {
      const j = JSON.parse((await res.json()).message.content);
      const score = Math.round(Number(j.score));
      if (score >= 1 && score <= 5) return { score, invented: !!j.invented, reason: String(j.reason ?? "") };
    } catch {}
  }
  return { score: 1, invented: false, reason: "judge unparseable" };
}

// ── run ───────────────────────────────────────────────────────────────
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

async function diagnoseCached(config, p, seed) {
  const key = createHash("sha1").update(JSON.stringify([config.model, p.draft, p.host, seed, DIAGNOSE_SYSTEM, config.temperature ?? null])).digest("hex").slice(0, 16);
  const file = join(cacheDir, `${key}.json`);
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const t = performance.now();
  const d = await diagnose({ config, draft: p.draft, host: p.host });
  const out = { d, s: (performance.now() - t) / 1000 };
  writeFileSync(file, JSON.stringify(out));
  return out;
}

const rows = [];
const bySeed = {};
for (const seed of seeds) {
  const config = { provider: "ollama", model, apiKey: "", seed, ...(temp === undefined ? {} : { temperature: Number(temp) }) };
  for (const p of prompts) {
    let row;
    try {
      const { d, s: c1 } = await diagnoseCached(config, p, seed);
      const answers = d.questions.map((q) => ({ question: q.question, answer: q.options[0] }));
      const t = performance.now();
      const out = await rewrite({ config, draft: p.draft, answers, host: p.host, reader: d.reader });
      const c2 = (performance.now() - t) / 1000;
      const checks = hardChecks({ draft: p.draft, keep: p.keep, answers, out });
      const j = await judge({ draft: p.draft, answers, rewrite: out.prompt, reader: d.reader });
      const hardOk = Object.values(checks).every(Boolean);
      row = { id: p.id, seed, reader: d.reader, nq: answers.length, c1, c2, checks, judge: j, hardOk, pass: hardOk && j.score >= 4 && !j.invented, rewrite: out.prompt };
    } catch (e) {
      row = { id: p.id, seed, error: String(e.message ?? e), c1: 0, c2: 0, judge: { score: 1 }, hardOk: false, pass: false, checks: {}, rewrite: "" };
    }
    rows.push(row);
    (bySeed[seed] ??= []).push(row);
    const failed = Object.entries(row.checks).filter(([, v]) => !v).map(([k]) => k).join(",");
    console.log(`seed ${seed} ${p.id.padEnd(18)} judge ${row.judge.score}${row.judge.invented ? "!" : " "} ${row.pass ? "PASS" : "fail"} c2 ${row.c2.toFixed(1)}s ${failed ? "[" + failed + "]" : ""}${row.error ? " ERR " + row.error : ""}`);
  }
}

const summarize = (rs) => ({ mean: mean(rs.map((r) => r.judge.score)), pass: rs.filter((r) => r.pass).length / rs.length, hard: rs.filter((r) => r.hardOk).length / rs.length,
  c2: median(rs.map((r) => r.c2)), total: median(rs.map((r) => r.c1 + r.c2)), n: rs.length });
const all = summarize(rows);
const per = seeds.map((s) => ({ seed: s, ...summarize(bySeed[s]) }));
const spread = Math.max(...per.map((x) => x.mean)) - Math.min(...per.map((x) => x.mean));
const pspread = Math.max(...per.map((x) => x.pass)) - Math.min(...per.map((x) => x.pass));
const fails = {};
for (const r of rows) for (const [k, v] of Object.entries(r.checks)) if (!v) fails[k] = (fails[k] ?? 0) + 1;
const result = { label, model, judgeModel, temp: temp ?? "default", seeds, all, per, spread, pspread, fails, rows };
writeFileSync(join(evalDir, "results", `${label}.json`), JSON.stringify(result, null, 1));
console.log(`\n${label}: model ${model} (judge ${judgeModel}), temp ${temp ?? "default"}, n=${all.n}`);
console.log(`mean ${all.mean.toFixed(2)} (seed spread ${spread.toFixed(2)}) · pass ${(all.pass * 100).toFixed(0)}% (spread ${(pspread * 100).toFixed(0)}pt) · hard-check pass ${(all.hard * 100).toFixed(0)}% · call 2 median ${all.c2.toFixed(1)}s · whole use median ${all.total.toFixed(1)}s`);
console.log("per seed: " + per.map((x) => `s${x.seed} mean ${x.mean.toFixed(2)} pass ${(x.pass * 100).toFixed(0)}%`).join(" | "));
console.log("hard-check failures: " + (JSON.stringify(fails) === "{}" ? "none" : JSON.stringify(fails)));
