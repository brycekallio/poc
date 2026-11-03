#!/usr/bin/env bash
# One command for "does everything still pass": extension tests, desktop tests, desktop compiles.
# (Building the signed POC.app is desktop/build.sh; it needs a normal terminal because codesign
# refuses files stamped by sandboxed tools.)
set -euo pipefail
cd "$(dirname "$0")"
echo "== extension: build + tests"; (cd extension && npm run build >/dev/null && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)")
echo "== desktop: swift test"; (cd desktop && swift test 2>&1 | grep -E "Executed [0-9]+ tests" | tail -1)
echo "== desktop: release build"; (cd desktop && swift build -c release 2>&1 | tail -1)
echo "verify: ok"
