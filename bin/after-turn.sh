#!/bin/bash

# After-turn hook: runs tsc, oxlint, vitest, and prettier
# Exits with status 2 if any check fails (ignoring warnings)

set -o pipefail

cd "$(dirname "$0")/.." || exit 2

echo "Running typecheck..."
if ! pnpm typecheck 2>&1; then
	echo "typecheck failed"
	exit 2
fi

echo "Running lint..."
if ! pnpm lint 2>&1; then
	echo "lint failed"
	exit 2
fi

echo "Running tests..."
if ! pnpm test:run 2>&1; then
	echo "tests failed"
	exit 2
fi

echo "Formatting..."
if ! pnpm format:write 2>&1; then
	echo "format:write failed"
	exit 2
fi

echo "All checks passed"
