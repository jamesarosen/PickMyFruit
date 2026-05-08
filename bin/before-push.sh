#!/usr/bin/env bash
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

echo "[before-push] Running quality gate..."
bin/quality-gate.sh || exit $?

echo "[before-push] Running E2E tests..."
pnpm -C apps/www test:e2e || exit $?

echo "[before-push] All checks passed."
