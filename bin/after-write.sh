#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

file_path="${1:-}"
if [ -z "$file_path" ]; then
  echo "[after-write] No file path provided" >&2
  exit 2
fi

[[ "$file_path" != /* ]] && file_path="$PROJECT_ROOT/$file_path"
[ ! -f "$file_path" ] && exit 0

# Run from apps/www so prettier finds the .prettierrc via config lookup
cd "$PROJECT_ROOT/apps/www" || exit 2

prettier_output=$(pnpm exec prettier --write "$file_path" 2>&1)
exit_code=$?

if [ $exit_code -ne 0 ]; then
  if echo "$prettier_output" | grep -qi "no parser could be inferred\|no parser found"; then
    exit 0
  fi
  echo "[after-write] prettier failed on $file_path" >&2
  echo "$prettier_output" >&2
  exit 2
fi

echo "[after-write] formatted $file_path"
