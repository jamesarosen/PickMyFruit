# @pickmyfruit/env

Exports an environment object with a validated schema.

Loads environment variables from the following sources, in order:

1.  `.env.${NODE_ENV}.local` -- per-developer per-environment values.
    see `.env.development.local.sample` for an example. These files are
    gitignored.
2.  `.env.${NODE_ENV}` -- per-environment values
    These files are checked into git.
3.  `.env.local` -- per-developer overrides. This file is gitignored.
4.  `.env` -- global defaults
5.  `process.env` -- environment variables set in the shell

After loading the environment variables, they are validated with a valibot
schema. The schema is an
[`objectWithRest`](https://valibot.dev/api/objectWithRest/),
so uknown keys are passed through as strings.

Unlike [dotenv](https://www.npmjs.com/package/dotenv)'s default behavior, this
package does not modify `process.env`. Instead, it exports the environment
object. This helps prevent process coupling -- where one part of the code
relies on another part having already modified `process.env`.

## Future Work

- [ ] support multiple schemas, e.g. for separate processes
- [ ] pull values from a secrets manager
