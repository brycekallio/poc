// The coaching session, driven through its interface with fixture calls: no
// browser, no API. Each review finding from 2026-10-28 has a test here.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/session.js";

const draft = "write a summary of the q3 report";
const questions = [
  { id: "audience", quote: "", question: "Who is it for?", options: ["The team", "Leadership"] },
  { id: "length", quote: "", question: "How long?", options: ["One page", "Any length"] },
];
const rewritten = { prompt: "Summarize our Q3 report for leadership in one page.", techniques: ["Clear deliverable"] };

// Scripted calls: each entry is a value to return or an error to throw.
function fixture({ diagnose = [{ questions }], rewrite = [rewritten] } = {}) {
  const calls = { diagnose: [], rewrite: [] };
  const next = (list, name) => async (...args) => {
    calls[name].push(args);
    const out = list[Math.min(calls[name].length - 1, list.length - 1)];
    if (out instanceof Error || out?.code) throw out;
    return out;
  };
  const session = createSession({ diagnose: next(diagnose, "diagnose"), rewrite: next(rewrite, "rewrite") });
  return { session, calls };
}

test("an unasked draft is idle; an empty box is empty", () => {
  const { session } = fixture();
  assert.deepEqual(session.view(draft), { kind: "idle", words: 7 });
  assert.equal(session.view("   ").kind, "empty");
});

test("ask → one question at a time → summary → rewrite → result", async () => {
  const { session, calls } = fixture();
  const asking = session.ask(draft);
  assert.equal(session.view(draft).kind, "loading");
  await asking;

  let v = session.view(draft);
  assert.equal(v.kind, "question");
  assert.equal(v.question.id, "audience");
  assert.equal(v.total, 2);
  session.choose("Leadership");
  assert.equal(session.view(draft).question.id, "length");
  session.choose(null); // Skip
  v = session.view(draft);
  assert.equal(v.kind, "summary");
  assert.deepEqual(v.answers, { audience: "Leadership", length: null });

  await session.rewrite();
  assert.deepEqual(calls.rewrite[0], [draft, [
    { question: "Who is it for?", answer: "Leadership" },
    { question: "How long?", answer: null },
  ]]);
  assert.deepEqual(session.view(draft), { kind: "result", result: rewritten });
});

test("re-hovering the same draft resumes; a changed draft starts fresh", async () => {
  const { session, calls } = fixture();
  await session.ask(draft);
  session.choose("The team");
  assert.equal(session.view(draft).question.id, "length");
  assert.equal(session.view(draft + " please").kind, "idle");
  assert.equal(session.view(draft).question.id, "length");
  assert.equal(calls.diagnose.length, 1);
});

test("a clear draft (no questions) still offers the rewrite", async () => {
  const { session } = fixture({ diagnose: [{ questions: [] }] });
  await session.ask(draft);
  assert.deepEqual(session.view(draft), { kind: "summary", questions: [], answers: {} });
  await session.rewrite();
  assert.equal(session.view(draft).kind, "result");
});

test("Try again after a failed rewrite keeps the answers and skips call 1", async () => {
  const failure = { code: "network", message: "Could not reach the Anthropic API." };
  const { session, calls } = fixture({ rewrite: [failure, rewritten] });
  await session.ask(draft);
  session.choose("Leadership");
  session.choose("One page");
  await session.rewrite();
  assert.deepEqual(session.view(draft), { kind: "error", error: failure });

  await session.retry();
  assert.equal(calls.diagnose.length, 1);
  assert.equal(calls.rewrite.length, 2);
  assert.deepEqual(calls.rewrite[1][1].map((a) => a.answer), ["Leadership", "One page"]);
  assert.equal(session.view(draft).kind, "result");
});

test("Try again after a failed ask asks again", async () => {
  const { session, calls } = fixture({ diagnose: [{ code: "rate-limit", message: "Rate limited." }, { questions }] });
  await session.ask(draft);
  assert.equal(session.view(draft).kind, "error");
  await session.retry();
  assert.equal(calls.diagnose.length, 2);
  assert.equal(session.view(draft).kind, "question");
});

test("an unexpected throw becomes a plain failure", async () => {
  const { session } = fixture({ diagnose: [new TypeError("boom")] });
  await session.ask(draft);
  assert.deepEqual(session.view(draft).error, { code: "unknown", message: "Something went wrong." });
});

test("Back from the result returns to the summary; Change answers to question 1", async () => {
  const { session } = fixture();
  await session.ask(draft);
  session.choose("The team");
  session.choose("One page");
  await session.rewrite();
  session.leaveResult();
  assert.equal(session.view(draft).kind, "summary");
  session.changeAnswers();
  const v = session.view(draft);
  assert.equal(v.question.id, "audience");
  assert.equal(v.answer, "The team");
});

test("a superseded request does not overwrite the newer one", async () => {
  let release;
  const slow = new Promise((r) => (release = r));
  let n = 0;
  const session = createSession({
    diagnose: () => (++n === 1 ? slow : Promise.resolve({ questions: [] })),
    rewrite: async () => rewritten,
  });
  const first = session.ask(draft);
  await session.ask(draft); // the newer ask lands first
  release({ questions });
  await first;
  assert.equal(session.view(draft).kind, "summary"); // still the newer, clear-draft result
});

test("used() spends the session", async () => {
  const { session } = fixture();
  await session.ask(draft);
  session.used();
  assert.equal(session.view(draft).kind, "idle");
});
