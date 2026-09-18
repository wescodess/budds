import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const stateDir = join(root, '.e2e')
const envFile = join(stateDir, 'convex.env')
const token = process.env.BUDDS_E2E_AUTH_TOKEN || 'e2e-local-token-please-do-not-use-outside-tests'
if (process.env.NODE_ENV === 'production' || process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_DEPLOYMENT) throw new Error('E2E stack refuses configured or production Convex deployments')
mkdirSync(stateDir, { recursive: true })
rmSync(envFile, { force: true })
writeFileSync(envFile, `BUDDS_E2E_MODE=true\nBUDDS_E2E_AUTH_TOKEN=${token}\nLEARN_V2_ENABLED=true\nLEARN_V2_BLUEPRINT_PROVIDER_ENABLED=true\nLEARN_V2_SESSION_PROVIDER_ENABLED=true\nLEARN_V2_BLUEPRINT_MODEL=budds-e2e-fixture.v1\nLEARN_V2_SESSION_MODEL=budds-e2e-fixture.v1\n`)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const convex = spawn(pnpm, ['exec', 'convex', 'dev', '--env-file', envFile, '--tail-logs', 'disable'], { cwd: root, env: { ...process.env, BUDDS_E2E_MODE: 'true', BUDDS_E2E_AUTH_TOKEN: token, LEARN_V2_ENABLED: 'true' }, stdio: 'inherit' })
const stop = () => { convex.kill('SIGTERM'); process.exit(0) }
process.once('SIGINT', stop); process.once('SIGTERM', stop)
const startedAt = Date.now()
while (!existsSync(envFile) || !readFileSync(envFile, 'utf8').match(/^CONVEX_URL=.+/m)) {
  if (Date.now() - startedAt > 90_000) throw new Error('Local Convex did not publish an isolated URL')
  await new Promise(resolve => setTimeout(resolve, 250))
}
const convexUrl = readFileSync(envFile, 'utf8').match(/^CONVEX_URL=(.+)$/m)?.[1]?.trim()
const nuxt = spawn(pnpm, ['exec', 'nuxt', 'dev', '--port', '3102'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', BUDDS_E2E_MODE: 'true', BUDDS_E2E_AUTH_TOKEN: token, LEARN_V2_ENABLED: 'true', CONVEX_URL: convexUrl, NUXT_PUBLIC_CONVEX_URL: convexUrl, NUXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3102', SITE_URL: 'http://127.0.0.1:3102' }, stdio: 'inherit' })
nuxt.once('exit', code => { convex.kill('SIGTERM'); process.exit(code ?? 1) })
