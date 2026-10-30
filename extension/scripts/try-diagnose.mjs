// Run call 1 against a draft from the terminal, without Chrome.
//
//   ANTHROPIC_API_KEY=sk-ant-… npm run try -- "draft prompt text"
//   ANTHROPIC_API_KEY=sk-ant-… npm run try -- --file draft.txt --model claude-opus-5-5
//
// Prints the diagnosis (which the panel never shows) and the questions. This is
// the loop for tuning DIAGNOSE_SYSTEM in src/coach.js: if the questions are
// generic, read the diagnosis first, since that is usually where it went wrong.
import { readFileSync } from "node:fs";
import { DEFAULT_MODEL, describeError, diagnose } from "../src/coach.js";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const file = flag("--file");
const model = flag("--model") ?? DEFAULT_MODEL;
// Where the box is, as content.js describes it: "mail.google.com", or
// "Claude, an AI chat site" (the default).
const host = flag("--host") ?? "Claude, an AI chat site";
const draft = file ? readFileSync(file, "utf8") : args.join(" ");

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY.");
  process.exit(1);
}
if (!draft.trim()) {
  console.error('Usage: npm run try -- "your draft prompt"  (or --file path)');
  process.exit(1);
}

const t0 = Date.now();
try {
  const { reader, diagnosis, questions } = await diagnose({ apiKey, model, draft, host });
  console.log(`\n${model} · ${((Date.now() - t0) / 1000).toFixed(1)}s · reader: ${reader}\n\nDIAGNOSIS (hidden in the panel)`);
  for (const d of diagnosis) console.log(`  - ${d}`);
  console.log("\nQUESTIONS");
  if (!questions.length) console.log("  (none: draft judged complete)");
  for (const q of questions) {
    console.log(`  ${q.question}`);
    for (const o of q.options) console.log(`     ○ ${o}`);
  }
  console.log();
} catch (err) {
  console.error(describeError(err).message);
  process.exit(1);
}
