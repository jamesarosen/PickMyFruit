#!/usr/bin/env bash
# Bootstraps a fresh cloud sandbox (Claude Cloud, Cursor Cloud Agents) so that
# subsequent agent turns find a workspace matching the committed lockfile.
# Safe to run from any cwd; locates the repo root from its own path.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[session-start] Activating pnpm via corepack…"
corepack enable
corepack prepare pnpm@10.22.0 --activate

# --frozen-lockfile makes a lockfile/package.json drift a loud error instead of
# a silent auto-resolve. In a cloud sandbox the lockfile is the source of truth.
echo "[session-start] Installing dependencies (frozen lockfile)…"
pnpm install --frozen-lockfile

echo "[session-start] Ensuring Playwright Chromium is installed…"
pnpm --dir apps/www exec playwright install --with-deps chromium

# Future consideration: `pnpm --dir apps/www db:push` to prep the dev SQLite DB
# up front. Deliberately omitted today because (a) not every agent wants a
# pre-seeded DB (e.g. one investigating a migration may want a clean slate),
# and (b) `db:push` mutates a file the agent might prefer to control itself.
# Reconsider if first-turn DB setup becomes a recurring source of friction.

echo "[session-start] Ready."
