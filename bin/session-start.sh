#!/usr/bin/env bash
# Bootstraps a fresh cloud sandbox (Claude Cloud, Cursor Cloud Agents) so that
# subsequent agent turns find a workspace matching the committed lockfile.
# Safe to run from any cwd; locates the repo root from its own path.
set -euo pipefail

cd "$(dirname "$0")/.."

# pnpm version is pinned via package.json's "packageManager" field; pnpm itself
# validates the running binary against it and refuses to run on a mismatch.
# Two supported ways to get a matching pnpm on PATH:
#   - Volta (typical local dev) — `volta install pnpm@<version>` once.
#   - Corepack (Node 16.10+; CI, Docker, cloud sandboxes) — activates the
#     version declared in "packageManager".
# Node version is governed by .npmrc's `use-node-version`, so once pnpm runs
# everything downstream gets the right Node automatically.
if command -v pnpm >/dev/null 2>&1; then
	echo "[session-start] Using pnpm already on PATH ($(pnpm --version))."
elif command -v corepack >/dev/null 2>&1; then
	echo "[session-start] No pnpm found; activating via corepack…"
	corepack enable
	corepack prepare pnpm@11.2.2 --activate
else
	echo "[session-start] Need pnpm on PATH, but neither pnpm nor corepack is available." >&2
	echo "[session-start] Install one of:" >&2
	echo "  - Volta:    https://volta.sh, then 'volta install pnpm@11.2.2'" >&2
	echo "  - Corepack: ships with Node >=16.10, then 'corepack enable'" >&2
	exit 1
fi

# --frozen-lockfile makes a lockfile/package.json drift a loud error instead of
# a silent auto-resolve. In a cloud sandbox the lockfile is the source of truth.
echo "[session-start] Installing dependencies (frozen lockfile)…"
pnpm install --frozen-lockfile

echo "[session-start] Ensuring Playwright Chromium is installed…"
pnpm --dir apps/www exec playwright install --with-deps chromium

# DB: no migrate here. `pnpm dev` runs pending migrations at boot when
# RUN_MIGRATIONS_ON_BOOT=true (.env.development). Vitest/Playwright migrate in setup.
# Agents: `db:generate` + commit SQL on schema changes; `db:migrate` to apply locally.
# Reset a bad dev DB with: rm -f apps/www/data/development.db*

echo "[session-start] Ready."
