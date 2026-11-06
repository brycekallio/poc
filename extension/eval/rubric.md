# Rewrite quality rubric (T2)

A rewrite is shown to the user only if it is good enough to paste. `npm run eval` scores each
rewrite two ways; both must pass for a rewrite to count as a **pass**.

## Hard checks (automatic, all must pass)

| Check | Fails when |
|---|---|
| `nonempty` | rewrite is empty or under 4 words |
| `no_refusal` | starts with "I'm sorry", "I can't", "As an AI" and the draft did not ask for it |
| `changed` | identical to the draft, or over 95% word overlap with it while also not longer |
| `intent` | any of the prompt's keep-words (names, numbers, key nouns in `prompts.json`) is missing |
| `no_chatter` | opens "Here is/Here's...", "Sure", "Certainly", "Rewritten prompt:", or closes "Let me know", or is wrapped in code fences/quotes |
| `length` | longer than max(90, 3x draft words + 50) words, or longer than 380 words |
| `uses_answers` | fewer than 60% of the user's answers show up (content words) in the rewrite |
| `internal` | the product's own `checkRewrite` still reports problems after its one retry (the popup would label it "unverified") |

## LLM judge (1-5, different local model from the one under test, temperature 0)

- **5** Ready to send. Keeps every fact, uses the answers, reads like the user wrote it with more time, concrete deliverable, nothing invented, no filler.
- **4** Good. Minor flaw: slightly wordy, one answer weakly used, a small amount of generic wording.
- **3** Usable with editing. Misses an answer or adds generic template language; still the same ask.
- **2** Weak. Loses facts, invents requirements, or turns into a template with headings/roles for a simple ask.
- **1** Unusable. Wrong task, answers the draft instead of rewriting it, refuses, or is gibberish.

Judge also flags `invented` (true when the rewrite adds facts, constraints or audiences the draft and answers never gave).

## Reported

- **mean**: mean judge score over all prompts x seeds (a hard-check failure does not zero the judge score, but it blocks a pass).
- **pass rate**: share with judge score >= 4 AND every hard check passing.
- **median latency**: call 2 (rewrite), and the whole use (call 1 + call 2).
- **noise**: each config runs at least 2 seeds; a change counts as better only if its mean (or pass rate) beats the baseline by more than the baseline's seed-to-seed spread, and the per-prompt paired difference is positive.

Canned answers: always the first option of each question call 1 asks, so the answers are
deterministic even though call 1's questions are not. Call 1 outputs are cached per
model/prompt/seed so a call-2 change is compared on identical questions.
