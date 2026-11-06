# T2 improvement log

Setup: 16 drafts x 2 seeds (n=32), canned answers = first option, rewrite model qwen2.5:latest,
judge hermes3:8b (temp 0). Same seeds are reproducible, so rerunning a config gives the same
numbers; the noise is **between seeds** (baseline: mean spread 0.56, pass spread 13pt). A change
counts as better only if mean rises by more than ~0.3 or pass rate by more than ~10pt, with neither
seed worse. **Latency caveat:** the Mac ran at load average ~70 (other workers) during the whole
session, so absolute seconds are 3-5x the quiet-machine 6 s. Compare latency only within a row of
this table, and see the quiet-machine check at the bottom.

| # | Change | Mean | Pass | Hard-check pass | Call 2 median | Kept? |
|---|---|---|---|---|---|---|
| 0 | baseline (current code, qwen2.5, default temp) | 4.16 | 50% | 63% | 27.1 s (loaded) | - |
| B | prompt: "each name, number, stated concern must appear; no invented numbers/rates/achievements", message prompt: work each answer in | 3.88 | 50% | 69% | 22.0 s | no (mean down, pass flat; inside noise) |
| C | temperature 0.3 (qwen2.5) | 4.06 | 44% | 69% | 11.1 s | no (no gain; lower pass) |
| D | model qwen2.5-coder:7b (judge hermes3:8b) | 3.91 | 44% | 63% | 10.6 s | no (worse mean, more internal failures: 9 vs baseline) |
| E | REWRITE_SYSTEM "Never do these" list (7 bullets) collapsed to one sentence, same rules | 4.22 | 59% | 69% | 18.3 s (loaded) | **yes** (score equal-or-better within noise, +9pt pass, seeds 4.44/4.00; shorter prompt) |
| F | E plus every rule it had dropped (IMPORTANT, bribes, "explain your reasoning", sections/instructions templates, "be comprehensive", "if in doubt, do more", remove-from-draft), still one sentence | 3.75 | 41% | 63% | 14.6 s (loaded) | no (worse than baseline; seeds 3.75/3.75) |

## Final

Kept: nothing in the product prompt. E (one-sentence "Never" list) beat baseline only inside the noise rule (4.22/59% vs 4.16/50%) and dropped rules (Codex gate review FAIL, high). F restored those rules in one sentence and scored worse (3.75/41%). So the rewrite prompt stays the 7-bullet baseline. Kept: the eval harness (`npm run eval`), rubric, test set and optional temperature/seed in compat calls. Rejected: B, C (temp 0.3), D (qwen2.5-coder:7b), E, F. Ollama first-run suggestion stays qwen2.5. Lesson: on qwen2.5 the prompt wording moves scores less than seed noise; the next lever is the model itself (a stronger local model) or fewer, sharper rules, judged on more seeds.
