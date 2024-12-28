import { config } from 'dotenv'
import * as v from 'valibot'

class InvalidEnvError extends Error {
  constructor(issues: v.BaseIssue<unknown>[]) {
    super(
      `Invalid environment variables:\n${issues.map((i) => `  - ${i.message} @ ${i.path?.map((p) => p.key).join('.')}`).join('\n')}`,
    )
    this.name = 'InvalidEnvError'
  }
}

// Load environment variables from .env files
const NODE_ENV = process.env.NODE_ENV ?? 'development'
const paths = [`.env.${NODE_ENV}.local`, '.env.local', `.env.${NODE_ENV}`, '.env']
const { parsed: env } = config({ path: paths, processEnv: {} })

// Parse and validate environment variables
const envSchema = v.objectWithRest({}, v.string())
const parsedEnv = v.safeParse(envSchema, { ...process.env, ...env })

if (!parsedEnv.success) {
  throw new InvalidEnvError(parsedEnv.issues)
}

console.debug(`[@pickmyfruit/env] loaded for ${NODE_ENV}`)
export default parsedEnv.output
