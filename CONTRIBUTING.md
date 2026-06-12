# Contributing to Pick My Fruit

Thanks for helping gardeners share surplus produce! This guide covers the
mechanics of getting a change from your machine into the project. Community
expectations live in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Getting set up

Requirements: Node 24 (via nvm) and pnpm — the exact versions are pinned in
`.npmrc` (`use-node-version`) and the root `package.json` (`packageManager`),
and `bin/session-start.sh` activates pnpm if it is missing from your PATH.

```sh
pnpm install                  # also installs the git pre-push hook
cd apps/www
pnpm db:migrate               # create + migrate the dev database
pnpm dev                      # dev server on http://localhost:5173
```

Magic-link sign-in in dev logs the token to the dev-server stdout
(`EMAIL_PROVIDER=console`) — look for the Pino log line containing `token:`.

## Conventions

Code conventions, project structure, and testing guidelines are documented in
[AGENTS.md](AGENTS.md) — both human and AI contributors should follow it.
Larger designs and decision records live in `docs/`.

## Quality gates

| Command                   | What it runs                            |
| ------------------------- | --------------------------------------- |
| `bash bin/after-turn.sh`  | format + lint + typecheck + unit tests  |
| `bash bin/before-push.sh` | the above plus the Playwright E2E suite |

The pre-push git hook (installed by `pnpm install`) runs `before-push.sh`
automatically. Please don't bypass it with `--no-verify` — CI runs the same
checks and will catch it anyway.

## Pull requests

- Fork PRs automatically get baseline CI (format, lint, typecheck, unit
  tests, build). The E2E suite and preview deploys run in the main
  repository once a maintainer adopts the branch.
- For anything larger than a small fix, please open an issue first so we can
  agree on direction before you invest time.
- Keep PRs focused; describe what changed and why.

## Questions

Email [james@pickmyfruit.com](mailto:james@pickmyfruit.com).
