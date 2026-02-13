#!/bin/bash

# Quality gate: runs typecheck, lint, tests, and format check.
# Used by /deliver before commit and by code-quality.sh (Stop hook).
# Exits with status 2 if any check fails.

set -o pipefail

cd "$(dirname "$0")/.." || exit 2

echo "[quality-gate] Running typecheck..."
errors=$(pnpm typecheck 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
	echo "[quality-gate] typecheck failed" >&2
	echo "$errors" >&2
	echo "" >&2
	echo "Review and fix these errors before proceeding." >&2
	exit 2
fi

echo "[quality-gate] Running lint..."
errors=$(pnpm lint 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
	echo "[quality-gate] lint failed" >&2
	echo "$errors" >&2
	echo "" >&2
	echo "Review and fix these errors before proceeding." >&2
	exit 2
fi

echo "[quality-gate] Running tests..."
errors=$(pnpm test:run 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
	echo "[quality-gate] tests failed" >&2
	echo "$errors" >&2
	echo "" >&2
	echo "Review and fix these errors before proceeding." >&2
	exit 2
fi

echo "[quality-gate] Checking formatting..."
errors=$(pnpm format:check 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
	echo "[quality-gate] formatting check failed" >&2
	echo "$errors" >&2
	echo "" >&2
	echo "Run 'pnpm format:write' to fix." >&2
	exit 2
fi

echo "All quality checks passed"
