#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

echo "[after-turn] Auto-formatting..."
format_stderr=$(pnpm format:write 2>&1 >/dev/null)
format_exit=$?
if [ $format_exit -ne 0 ]; then
	echo "[after-turn] format:write failed (exit $format_exit)" >&2
	[ -n "$format_stderr" ] && echo "$format_stderr" >&2
	exit $format_exit
fi

echo "[after-turn] Running quality gate..."
bin/quality-gate.sh
exit $?
