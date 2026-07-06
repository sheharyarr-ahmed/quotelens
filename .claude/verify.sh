#!/usr/bin/env bash
# QuoteLens verify gate — wired into the Claude Code Stop hook.
# Gates on: backend pytest, mobile tsc --noEmit, mobile eslint (SPEC.md · Verification 1–2).
# Each check is skipped with a notice until its workspace exists, so early
# scaffold sessions are not blocked by checks for code that isn't written yet.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

check() {
  local name="$1" dir="$2"
  shift 2
  if [ ! -d "$ROOT/$dir" ]; then
    echo "verify: SKIP $name ($dir/ not scaffolded yet)"
    return 0
  fi
  echo "verify: RUN  $name"
  if (cd "$ROOT/$dir" && "$@"); then
    echo "verify: PASS $name"
  else
    echo "verify: FAIL $name"
    FAILED=1
  fi
}

check "backend pytest"  backend uv run pytest -q
check "mobile tsc"      mobile pnpm exec tsc --noEmit
check "mobile eslint"   mobile pnpm exec eslint .

if [ "$FAILED" -ne 0 ]; then
  echo "verify: gate FAILED — fix before stopping" >&2
  exit 2
fi
echo "verify: gate passed"
