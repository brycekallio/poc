// The code half of "techniques every time": checkRewrite() must catch a missing
// decision, fake evidence, and each must-not the research lists.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { TECHNIQUES, checkRewrite } from "../src/coach.js";

const draft = "write a summary of the q3 report for the team, not too long";
const prompt =
  "Summarize our Q3 report for leadership in one page of prose. Focus on results and risks, since they will skim it before Monday's review. A good summary lets them decide whether to fund the second phase.";
const decided = (overrides = {}) =>
  TECHNIQUES.map((t) => ({
    id: t.id,
    applied: true,
    evidence: {
      deliverable: "Summarize our Q3 report",
      purpose: "for leadership",
      format: "one page of prose",
      scope: "Focus on results and risks",
      success: "A good summary lets them decide",
      reasons: "since they will skim it before Monday's review",
      material: "",
    }[t.id],
    ...(t.id === "material" ? { applied: false, evidence: "Nothing is pasted." } : {}),
    ...overrides[t.id],
  }));

test("a good rewrite passes", () => {
  assert.deepEqual(checkRewrite({ prompt, techniques: decided() }, draft), []);
});

test("every technique needs a decision", () => {
  const p = checkRewrite({ prompt, techniques: decided().filter((t) => t.id !== "success") }, draft);
  assert.match(p.join(), /No decision for "success"/);
});

test("the deliverable is always applied", () => {
  const p = checkRewrite({ prompt, techniques: decided({ deliverable: { applied: false, evidence: "n/a" } }) }, draft);
  assert.match(p.join(), /"deliverable" must always be applied/);
});

test("claimed evidence must really be in the prompt", () => {
  const p = checkRewrite({ prompt, techniques: decided({ format: { evidence: "as a bulleted list" } }) }, draft);
  assert.match(p.join(), /evidence for "format"/);
});

test("must-nots are caught", () => {
  const cases = [
    ["This is CRITICAL: summarize the report.", /ALL-CAPS/],
    ["Summarize the report. Think step by step.", /step by step/],
    ["Summarize the report. Be thorough.", /filler/],
    ["## Task\nSummarize the report.", /headings/],
    ['{"document": "q3"} Summarize it.', /JSON/],
  ];
  for (const [bad, re] of cases) {
    const t = decided({ deliverable: { evidence: "Summarize" }, purpose: { applied: false, evidence: "-" }, format: { applied: false, evidence: "-" }, scope: { applied: false, evidence: "-" }, success: { applied: false, evidence: "-" }, reasons: { applied: false, evidence: "-" } });
    assert.match(checkRewrite({ prompt: bad, techniques: t }, draft).join(), re, bad);
  }
});

test("acronyms the user wrote are not treated as shouting", () => {
  const t = decided({ deliverable: { evidence: "Summarize the NASA" } });
  const ok = checkRewrite({ prompt: "Summarize the NASA budget for leadership in one page of prose.", techniques: t }, "summarize the NASA budget");
  assert.ok(!ok.join().includes("ALL-CAPS"));
});
