#!/usr/bin/env bash
# Installs git hooks. Invoked from the root `postinstall` script.
# - Resolves the hooks dir via `git rev-parse --git-path hooks`, which works for
#   regular repos, worktrees (where `.git` is a file), and submodules.
# - Refuses to clobber a pre-existing pre-push hook unless it already points at
#   `bin/before-push.sh`. This avoids overwriting a contributor's hand-written
#   hook or one installed by another tool (Husky, lefthook, etc.).
set -uo pipefail

# Skip when not inside a git working tree (e.g. pnpm install from a tarball,
# or a CI container that copies sources without `.git`).
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	exit 0
fi

# Skip from worktrees: the hooks dir is shared with the main checkout, and a
# symlink into a worktree's `bin/` would break if that worktree is later
# removed. Run `pnpm install` in the main checkout to install hooks.
if [ "$(git rev-parse --git-common-dir)" != "$(git rev-parse --git-dir)" ]; then
	echo "[install-git-hooks] skipping in git worktree; install hooks from the main checkout"
	exit 0
fi

project_root="$(git rev-parse --show-toplevel)"
hooks_dir="$(git rev-parse --git-path hooks)"
[[ "$hooks_dir" != /* ]] && hooks_dir="$project_root/$hooks_dir"

mkdir -p "$hooks_dir" || exit 0

target="$project_root/bin/before-push.sh"
hook_path="$hooks_dir/pre-push"

if [ -e "$hook_path" ] || [ -L "$hook_path" ]; then
	# Already pointing at our script — re-link to refresh and exit quietly.
	if [ -L "$hook_path" ] && [ "$(readlink "$hook_path")" = "$target" ]; then
		ln -sfn "$target" "$hook_path"
		echo "[install-git-hooks] pre-push already installed"
		exit 0
	fi
	echo "[install-git-hooks] pre-push hook exists at $hook_path; not overwriting." >&2
	echo "[install-git-hooks] Remove it (or symlink it to bin/before-push.sh) to re-enable the project's pre-push gate." >&2
	exit 0
fi

ln -s "$target" "$hook_path"
echo "[install-git-hooks] pre-push hook installed"
