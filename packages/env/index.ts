import { config, type DotenvPopulateInput } from 'dotenv'

const NODE_ENV = process.env.NODE_ENV ?? 'development'

const env: DotenvPopulateInput = {}

config({ path: [`.env.${NODE_ENV}.local`, '.env.local', `.env.${NODE_ENV}`, '.env'], processEnv: env })

console.debug(`@pickmyfruit/env configured environment for ${NODE_ENV}`, env)
