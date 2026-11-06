#!/usr/bin/env bash
# One command for "does everything still pass": extension tests, desktop tests, desktop compiles.
# `./verify.sh --e2e` also runs the real coach loop against local Ollama (skips if it is not running; E2E_MODEL overrides the model).
# (Building the signed POC.app is desktop/build.sh; it needs a normal terminal because codesign
# refuses files stamped by sandboxed tools.)
set -euo pipefail
cd "$(dirname "$0")"
echo "== extension: build + tests"; (cd extension && npm run build >/dev/null && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)")
echo "== desktop: swift test"; (cd desktop && swift test 2>&1 | grep -E "Executed [0-9]+ tests" | tail -1)
echo "== desktop: release build"; (cd desktop && swift build -c release 2>&1 | tail -1)
if [ "${1:-}" = "--e2e" ]; then
  # Opt-in: the real coach loop (bundled JS in a hidden web view: questions -> answer -> rewrite) against
  # local Ollama. Structural checks only; the harness exits non-zero if the loop breaks. E2E_MODEL overrides the model.
  if ! curl -sf -m 3 http://localhost:11434/api/tags >/dev/null; then
    echo "e2e: skipped (Ollama not running)"
  else
    echo "== e2e: coach loop via POCHarness (${E2E_MODEL:-qwen2.5:latest})"
    (cd desktop && swift run -c release POCHarness --provider ollama --model "${E2E_MODEL:-qwen2.5:latest}" --web "$PWD/Resources/web" --timeout 120 2>&1 | grep -vE "^(\[|Building|Compiling|Build)")
  fi
fi
echo "verify: ok"
