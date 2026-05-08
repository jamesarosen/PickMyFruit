# 0006 — Three-Tier Quality Gate

## Problem

Claude agents run `bin/quality-gate.sh` via the Stop hook, but that script does not run E2E or cross-package integration tests. Agents break these higher-order tests, which only surfaces in CI — slowing iteration.

## Decision

Graduate checks into three tiers:

| Tier     | When                   | Script                      | What runs                                    |
| -------- | ---------------------- | --------------------------- | -------------------------------------------- |
| Per-file | After every Edit/Write | `bin/after-write.sh <path>` | prettier on the changed file                 |
| Per-turn | Claude Stop hook       | `bin/after-turn.sh`         | format:write → typecheck → lint → unit tests |
| Pre-push | git pre-push hook      | `bin/before-push.sh`        | quality gate + E2E tests                     |

The git pre-push hook is the right place for tier three because it fires regardless of what calls `git push` — including scripts that Claude runs indirectly.

---

## Implementation

### New scripts

#### `bin/after-write.sh`

Called from the Claude PostToolUse hook after every Edit/Write. Runs prettier on the written file. Silently skips files with no supported parser (`.sh`, lock files, etc.). Exits 2 on parse error (e.g., broken syntax in a `.ts` file).

```bash
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

stderr_output=$(pnpm exec prettier --write "$file_path" 2>&1)
exit_code=$?

if [ $exit_code -ne 0 ]; then
  if echo "$stderr_output" | grep -qi "no parser could be inferred\|no parser found"; then
    exit 0
  fi
  echo "[after-write] prettier failed on $file_path" >&2
  echo "$stderr_output" >&2
  exit 2
fi
```

#### `bin/after-turn.sh`

Called from the Claude Stop hook. Auto-formats first (unconditionally — fast and idempotent), then delegates to `quality-gate.sh`. Replaces `code-quality.sh`.

```bash
#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

echo "[after-turn] Auto-formatting..."
pnpm format:write >/dev/null 2>&1

echo "[after-turn] Running quality gate..."
bin/quality-gate.sh
exit $?
```

#### `bin/before-push.sh`

Installed as `.git/hooks/pre-push` via `pnpm postinstall`. Runs the full quality gate (pure check, no mutations) then E2E tests.

```bash
#!/usr/bin/env bash
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

echo "[before-push] Running quality gate..."
bin/quality-gate.sh || exit $?

echo "[before-push] Running E2E tests..."
pnpm -C apps/www test:e2e || exit $?

echo "[before-push] All checks passed."
```

Resolves the project root from git rather than via `$0` because `$0` points at the symlink inside `.git/hooks/` when git invokes the hook, and `dirname/..` would land in `.git/` instead of the project root. `git rev-parse --show-toplevel` works in both invocation contexts (hook and direct `bash bin/before-push.sh`).

Uses `pnpm -C apps/www` (location-based) rather than `--filter @pickmyfruit/www` (name-based) so it doesn't break if the package name changes.

---

### Modified files

#### `bin/code-quality.sh`

Delete. The Stop hook now points at `bin/after-turn.sh` directly and no in-repo callers remain. (An earlier iteration left a backward-compat `exec` alias here; it was removed once verified unused.)

#### `.claude/settings.json`

- **PostToolUse**: call `bin/after-write.sh` instead of inlining prettier. Use `read file_path` subshell (same pattern as today) for correct handling of paths with spaces.
- **Stop**: call `bin/after-turn.sh` instead of `bin/code-quality.sh`.

```json
{
	"hooks": {
		"PostToolUse": [
			{
				"matcher": "Edit|Write",
				"hooks": [
					{
						"type": "command",
						"command": "jq -r '.tool_input.file_path' | { read file_path; ${CLAUDE_PROJECT_DIR}/bin/after-write.sh \"$file_path\"; }"
					}
				]
			}
		],
		"Stop": [
			{
				"hooks": [
					{
						"type": "command",
						"command": "${CLAUDE_PROJECT_DIR}/bin/after-turn.sh"
					}
				]
			}
		]
	},
	"permissions": {
		"allow": ["Bash(./bin/*)", "Bash(bin/*)", "mcp__context7__query-docs"]
	}
}
```

#### Root `package.json` — add `postinstall`

```json
"postinstall": "bash bin/install-git-hooks.sh"
```

`bin/install-git-hooks.sh` resolves the hooks directory via `git rev-parse --git-path hooks` (so it works in worktrees, where `.git` is a file pointing at a per-worktree git dir) and refuses to overwrite a pre-existing `pre-push` hook unless it already symlinks to `bin/before-push.sh`. That keeps the install idempotent without clobbering hooks installed by Husky, lefthook, or hand-written by a contributor.

#### `CLAUDE.md` — update "Commit gate" section

Replace:

> Before every commit, run `bash bin/code-quality.sh` from the repo root.

With:

> Before every commit, run `bash bin/after-turn.sh` from the repo root. The git pre-push hook runs `bash bin/before-push.sh` (quality gate + E2E tests) automatically on `git push`. Never skip it with `--no-verify`.

Add rows to the common commands table:

| Task                                                   | Command                          |
| ------------------------------------------------------ | -------------------------------- |
| Per-file format                                        | `bash bin/after-write.sh <path>` |
| Per-turn gate (format + lint + typecheck + unit tests) | `bash bin/after-turn.sh`         |
| Pre-push gate (turn gate + E2E)                        | `bash bin/before-push.sh`        |

---

### Unchanged

- `bin/quality-gate.sh` — remains the authoritative check sequence; called by `after-turn.sh` and `before-push.sh`

---

## Implementation process

The Director orchestrates Alice (Principal DX Engineer) and Bob (Staff Web Engineer) in a loop:

1. **Alice**: implement, provide evidence each script behaves as specified, commit
2. **Bob**: review the commit, give prioritized feedback
3. **Alice**: address CRITICAL and HIGH findings, provide evidence, commit
4. **Push**

### Alice's verification checklist

```bash
# 1. after-write.sh formats a .ts file
bash bin/after-write.sh apps/www/src/lib/logger.server.ts
echo "Exit: $?"  # expect 0

# 2. after-write.sh silently skips an unsupported file type
bash bin/after-write.sh bin/quality-gate.sh
echo "Exit: $?"  # expect 0, no output

# 3. after-write.sh exits 2 on broken syntax
printf 'const x = {{{\n' > /tmp/broken.ts
bash bin/after-write.sh /tmp/broken.ts
echo "Exit: $?"  # expect 2
rm /tmp/broken.ts

# 4. after-turn.sh passes on clean repo
bash bin/after-turn.sh
echo "Exit: $?"  # expect 0

# 5. pnpm install installs the git hook
pnpm install
ls -la .git/hooks/pre-push  # expect symlink → ../../bin/before-push.sh

# 6. before-push.sh runs quality gate + E2E (slow)
bash bin/before-push.sh
echo "Exit: $?"  # expect 0
```
