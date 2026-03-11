#!/usr/bin/env bash
# Manage git worktrees for PickMyFruit development.
#
# Usage:
#   bin/worktree.sh create <branch-name>
#     Creates a new worktree branching off main, runs pnpm install,
#     and copies local config files (.env, apps/www/local.db,
#     apps/www/.env, apps/www/.env.development.local) from the current
#     repo root into the new worktree.
#
#   bin/worktree.sh remove <path>
#     Removes a worktree. Refuses if the target is the primary worktree,
#     the branch is main, the branch has detached HEAD, or there is an
#     open GitHub pull request on the branch.

set -euo pipefail

SUBCOMMAND="${1:-}"

worktree_create() {
	local branch="${1:-}"
	if [[ -z "${branch}" ]]; then
		echo "Usage: bin/worktree.sh create <branch-name>" >&2
		exit 1
	fi

	# Use the repo root regardless of where the script is invoked from.
	local source_dir
	source_dir="$(git rev-parse --show-toplevel)"

	# Derive the worktree directory name from the part after the last "/":
	# feat/some-feature → pmf-some-feature
	local short_name="${branch##*/}"
	local worktree_dir
	worktree_dir="$(dirname "${source_dir}")/pmf-${short_name}"

	# Guard: worktree directory already exists
	if [[ -d "${worktree_dir}" ]]; then
		echo "Error: Directory '${worktree_dir}' already exists." >&2
		echo "Choose a different branch name or remove the directory first." >&2
		exit 1
	fi

	# Guard: branch already exists locally
	if git show-ref --verify --quiet "refs/heads/${branch}"; then
		echo "Error: Local branch '${branch}' already exists." >&2
		echo "To check it out in a new worktree without creating a new branch, run:" >&2
		echo "  git worktree add '${worktree_dir}' '${branch}'" >&2
		exit 1
	fi

	echo "=== Creating worktree: pmf-${short_name} (branch: ${branch})"
	git worktree add -b "${branch}" "${worktree_dir}" main

	echo "=== Installing dependencies ==="
	(cd "${worktree_dir}" && pnpm install)

	echo "=== Copying local config files ==="
	local files=(
		".env"
		"apps/www/local.db"
		"apps/www/.env"
		"apps/www/.env.development.local"
	)
	for file in "${files[@]}"; do
		if [[ -f "${source_dir}/${file}" ]]; then
			cp "${source_dir}/${file}" "${worktree_dir}/${file}"
			echo "  Copied ${file}"
		else
			echo "  Skipped ${file} (not found in source)"
		fi
	done

	echo "=== Done! Worktree ready at ../pmf-${short_name}"
}

worktree_remove() {
	local target="${1:-}"
	if [[ -z "${target}" ]]; then
		echo "Usage: bin/worktree.sh remove <path>" >&2
		exit 1
	fi

	# Guard: target must be a directory
	if [[ ! -d "${target}" ]]; then
		echo "Error: '${target}' is not a directory." >&2
		exit 1
	fi

	# Resolve to absolute path
	local abs_path
	abs_path="$(cd "${target}" && pwd)"

	# Guard: do not remove the primary worktree (first entry in git worktree list)
	local primary_worktree
	primary_worktree="$(git worktree list --porcelain | awk 'NR==1{print $2}')"
	if [[ "${abs_path}" == "${primary_worktree}" ]]; then
		echo "Error: Refusing to remove the primary worktree at '${abs_path}'." >&2
		exit 1
	fi

	# Get the branch name for this worktree
	local branch
	branch="$(cd "${abs_path}" && git rev-parse --abbrev-ref HEAD)"

	# Guard: detached HEAD — cannot reliably determine branch for PR check
	if [[ "${branch}" == "HEAD" ]]; then
		echo "Error: Worktree is in detached HEAD state; cannot safely determine branch." >&2
		exit 1
	fi

	# Guard: refuse to remove main
	if [[ "${branch}" == "main" ]]; then
		echo "Error: Refusing to remove the 'main' branch worktree." >&2
		exit 1
	fi

	# Check for open PRs (requires gh CLI). Fail closed if gh is unavailable or errors.
	if ! command -v gh &>/dev/null; then
		echo "Error: gh CLI is required to check for open pull requests before removing." >&2
		echo "Install gh (https://cli.github.com/) or remove the worktree manually with:" >&2
		echo "  git worktree remove '${abs_path}'" >&2
		exit 1
	fi

	echo "Checking for open pull requests on branch '${branch}'..."
	local pr_count
	if ! pr_count="$(gh pr list --head "${branch}" --state open --json number --jq 'length' 2>/dev/null)"; then
		echo "Error: gh CLI failed to query pull requests. Refusing to remove without confirmation." >&2
		echo "Verify 'gh pr list --head ${branch}' works, or remove manually with:" >&2
		echo "  git worktree remove '${abs_path}'" >&2
		exit 1
	fi

	if [[ "${pr_count}" -gt 0 ]]; then
		local pr_url
		pr_url="$(gh pr list --head "${branch}" --state open --json url --jq '.[0].url')"
		echo "Error: Branch '${branch}' has an open pull request: ${pr_url}" >&2
		echo "Merge or close the PR before removing this worktree." >&2
		exit 1
	fi

	echo "=== Removing worktree: ${abs_path} (branch: ${branch}) ==="
	git worktree remove "${abs_path}"
	echo "=== Done! Removed worktree: ${abs_path}"
}

case "${SUBCOMMAND}" in
create) worktree_create "${2:-}" ;;
remove) worktree_remove "${2:-}" ;;
*)
	echo "Usage: bin/worktree.sh <create|remove> [args...]" >&2
	echo "  create <branch-name>  Create a new worktree branching off main" >&2
	echo "  remove <path>         Remove a worktree (with safety checks)" >&2
	exit 1
	;;
esac
