# @pickmyfruit/env

This package handles environment variables (including secrets) for the
various environments. Some example use-cases:

- A developer wants to get going quickly and pulls the default environment
  variables from 1Password.
- A developer wants to override specific environment variables for their
  local development environment.
- GitHub Actions don't support IPv6, so that environment needs a different
  Postgres connection URL.

## From TypeScript

`@pickmyfruit/env` exports an environment object with a validated schema.

Loads environment variables from the following sources, in order:

1.  `.env.${NODE_ENV}.local` -- per-developer per-environment values.
    Developers are free to use these for their own purposes. These files are
    gitignored.
2.  `.env.${NODE_ENV}` -- per-environment values. These files are generated
    via 1Password from `.env.tpl`.
3.  `.env.local` -- per-developer overrides. This file is gitignored.
4.  `.env` -- global defaults.
5.  `process.env` -- environment variables set in the shell

After loading the environment variables, they are validated with a valibot
schema. The schema is an
[`objectWithRest`](https://valibot.dev/api/objectWithRest/),
so uknown keys are passed through as strings.

Unlike [dotenv](https://www.npmjs.com/package/dotenv)'s default behavior, this
package does not modify `process.env`. Instead, it exports the environment
object. This helps prevent process coupling -- where one part of the code
relies on another part having already modified `process.env`.

## Fetching Secrets from 1Password

1. Install the [1Password CLI](https://developer.1password.com/docs/cli/get-started/)
2. Run `NODE_ENV=development pnpm pull` to generate `.env.development` from
   `.env.tpl`

## Future Work

- [ ] support multiple schemas, e.g. for separate processes
