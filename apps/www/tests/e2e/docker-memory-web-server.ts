import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../../../..')
const wwwRoot = resolve(repoRoot, 'apps/www')
const runtimeDir = resolve(wwwRoot, '.docker-memory')
const dataDir = resolve(runtimeDir, 'data')
const containerName = 'pmf-docker-memory-e2e'
const imageTag = 'pickmyfruit-www:docker-memory-e2e'
const port = process.env.DOCKER_MEMORY_PORT ?? '5175'
const dockerBin = process.env.DOCKER_BIN ?? 'docker'

function docker(args: string[], opts: { stdio?: 'inherit' | 'pipe' } = {}) {
	try {
		return execFileSync(dockerBin, args, {
			cwd: repoRoot,
			encoding: 'utf8',
			stdio: opts.stdio ?? 'pipe',
		})
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(
				`Docker memory E2E suite requires the Docker CLI. Set DOCKER_BIN if it is not named "docker".`,
				{ cause: err }
			)
		}
		throw err
	}
}

function cleanupContainer() {
	try {
		docker(['rm', '-f', containerName])
	} catch {
		// The container may not exist yet.
	}
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function checkHealth(url: string): Promise<boolean> {
	try {
		const response = await fetch(url)
		return response.ok
	} catch {
		return false
	}
}

async function waitForHealth() {
	const deadline = Date.now() + 60_000
	const url = `http://127.0.0.1:${port}/api/health`

	// Polling is the expected contract for Playwright web servers.
	/* eslint-disable no-await-in-loop */
	while (Date.now() < deadline) {
		if (await checkHealth(url)) {
			return
		}
		await sleep(500)
	}
	/* eslint-enable no-await-in-loop */

	throw new Error(`Docker memory test server did not become healthy at ${url}`)
}

process.on('SIGTERM', () => {
	cleanupContainer()
	process.exit(0)
})
process.on('SIGINT', () => {
	cleanupContainer()
	process.exit(0)
})
process.on('exit', cleanupContainer)

cleanupContainer()
mkdirSync(dataDir, { recursive: true })
rmSync(resolve(dataDir, 'uploads'), { recursive: true, force: true })

docker(
	[
		'build',
		'--file',
		'apps/www/Dockerfile',
		'--tag',
		imageTag,
		'--build-arg',
		'VITE_SENTRY_ENABLED=false',
		'--build-arg',
		'VITE_SENTRY_DSN=https://1234567890abcdef@o111111111.ingest.sentry.io/222334456',
		'.',
	],
	{ stdio: 'inherit' }
)

spawn(
	dockerBin,
	[
		'run',
		'--rm',
		'--name',
		containerName,
		'--memory',
		'256m',
		'--memory-swap',
		'256m',
		'--cpus',
		'1',
		'--publish',
		`${port}:3000`,
		'--volume',
		`${dataDir}:/app/data`,
		'--env',
		'BETTER_AUTH_SECRET=test-secret-for-docker-e2e-minimum-32-characters',
		'--env',
		`BETTER_AUTH_URL=http://127.0.0.1:${port}`,
		'--env',
		'DATABASE_URL=file:/app/data/test.db',
		'--env',
		'DATA_DIR=/app/data',
		'--env',
		'EMAIL_FROM=Test <test@example.com>',
		'--env',
		'EMAIL_PROVIDER=silent',
		'--env',
		'HMAC_SECRET=test-secret-for-docker-e2e-minimum-32-characters',
		'--env',
		'MIGRATE_ON_REQUEST=true',
		'--env',
		'NODE_ENV=test',
		'--env',
		'SHARP_CONCURRENCY=1',
		'--env',
		'STORAGE_PROVIDER=local',
		imageTag,
	],
	{ cwd: repoRoot, stdio: 'inherit' }
)

await waitForHealth()

// Keep this process alive so Playwright can stop it after the suite finishes.
await new Promise(() => {})
