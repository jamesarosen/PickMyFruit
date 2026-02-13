#!/bin/bash

# Stop-hook safety net: runs quality gate, auto-fixing formatting if needed.
# This wraps bin/quality-gate.sh with an auto-fix retry for formatting,
# since the Stop hook has no retry loop (unlike /deliver).

set -o pipefail

cd "$(dirname "$0")/.." || exit 2

bin/quality-gate.sh
exit_code=$?

if [ $exit_code -ne 0 ]; then
	# Only retry if formatting might be the issue
	if ! pnpm format:check >/dev/null 2>&1; then
		echo "[code-quality] Formatting issues detected. Auto-fixing and retrying..."
		pnpm format:write >/dev/null 2>&1
		bin/quality-gate.sh
		exit $?
	fi
	# Non-formatting failure — don't waste time retrying
	exit $exit_code
fi
