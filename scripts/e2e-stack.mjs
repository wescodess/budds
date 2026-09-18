import { spawn } from 'node:child_process'

const root = process.cwd()
const token = process.env.BUDDS_E2E_AUTH_TOKEN || 'e2e-local-token-please-do-not-use-outside-tests'
if (process.env.NODE_ENV === 'production' || process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_DEPLOYMENT) throw new Error('E2E stack refuses configured or production Convex deployments')
const convexUrl = process.env.BUDDS_E2E_CONVEX_URL?.trim()
if (!convexUrl || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/u.test(convexUrl)) {
  throw new Error('E2E requires BUDDS_E2E_CONVEX_URL for a separately started local Convex deployment; see docs/qa/learn-v2-browser-e2e.md')
}
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const nuxt = spawn(pnpm, ['exec', 'nuxt', 'dev', '--port', '3102'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', BUDDS_E2E_MODE: 'true', BUDDS_E2E_AUTH_TOKEN: token, LEARN_V2_ENABLED: 'true', CONVEX_URL: convexUrl, NUXT_PUBLIC_CONVEX_URL: convexUrl, NUXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3102', SITE_URL: 'http://127.0.0.1:3102' }, stdio: 'inherit' })
nuxt.once('exit', code => process.exit(code ?? 1))
