#!/bin/bash

# After-turn hook: runs tsc, oxlint, vitest, and prettier
# Exits with status 2 if any check fails (ignoring warnings)

set -o pipefail

cd "$(dirname "$0")/.." || exit 2

echo "[after-turn] Running typecheck..."
errors=$(pnpm typecheck 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
	echo "[after-turn] typecheck failed" >&2
	echo "$errors" >&2
	echo "" >&2
	echo "Review and fix these errors before proceeding." >&2
	exit 2  # Block
fi

echo "[after-turn] Running lint..."
errors=$(pnpm lint 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
	echo "[after-turn] lint failed" >&2
	echo "$errors" >&2
	echo "" >&2
	echo "Review and fix these errors before proceeding." >&2
	exit 2
fi

echo "Running tests..."
errors=$(pnpm test:run 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
	echo "[after-turn] tests failed" >&2
	echo "$errors" >&2
	echo "" >&2
	echo "Review and fix these errors before proceeding." >&2
	exit 2
fi

echo "Formatting..."
errors=$(pnpm format:write 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
	echo "[after-turn] format:write failed" >&2
	echo "$errors" >&2
	echo "" >&2
	echo "Review and fix these errors before proceeding." >&2
	exit 2
fi

echo "All checks passed"
