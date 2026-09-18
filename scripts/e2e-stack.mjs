import { spawn, execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const root = process.cwd()
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const token = process.env.BUDDS_E2E_AUTH_TOKEN || 'e2e-local-token-please-do-not-use-outside-tests'
const baseUrl = process.env.BUDDS_E2E_BASE_URL || 'http://127.0.0.1:3102'

if (process.env.NODE_ENV === 'production' || process.env.CONVEX_DEPLOY_KEY) throw new Error('E2E stack refuses production mode and Convex deploy keys')
if (process.env.BUDDS_E2E_CONVEX_URL) throw new Error('BUDDS_E2E_CONVEX_URL is unsupported: the runner creates its own disposable local Convex deployment')
if (token.length < 32) throw new Error('BUDDS_E2E_AUTH_TOKEN must contain at least 32 characters')

const inheritedEnv = { ...process.env }
for (const key of ['CONVEX_DEPLOYMENT', 'CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN', 'CONVEX_URL', 'CONVEX_SITE_URL', 'NUXT_PUBLIC_CONVEX_URL', 'AUTH_PROXY_TARGET_URL']) Reflect.deleteProperty(inheritedEnv, key)

let isolatedRoot
let convex
let nuxt
let cleaned = false

function stop(child) {
  if (!child || child.exitCode !== null || child.killed) return
  child.kill('SIGTERM')
}

async function cleanup() {
  if (cleaned) return
  cleaned = true
  stop(nuxt)
  stop(convex)
  if (isolatedRoot) await execFile('git', ['worktree', 'remove', '--force', isolatedRoot], { cwd: root }).catch(() => rm(dirname(isolatedRoot), { recursive: true, force: true }))
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)) })
}

function parseEnv(contents, name) {
  const match = contents.match(new RegExp(`^${name}=([^\\r\\n]+)$`, 'm'))
  return match?.[1]?.trim() || null
}

function assertLoopbackUrl(value, label) {
  let url
  try { url = new URL(value) } catch { throw new Error(`${label} is not a valid URL`) }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`${label} must be an HTTP loopback URL`)
  return url.toString().replace(/\/$/u, '')
}

async function waitForLocalConvex(worktree) {
  const deadline = Date.now() + 120_000
  const envFile = join(worktree, '.env.local')
  while (Date.now() < deadline) {
    const contents = await readFile(envFile, 'utf8').catch(() => '')
    const url = parseEnv(contents, 'VITE_CONVEX_URL')
    if (url) {
      const localUrl = assertLoopbackUrl(url, 'Convex local deployment URL')
      if (await fetch(`${localUrl}/instance_name`).then(response => response.ok).catch(() => false)) return localUrl
    }
    if (convex?.exitCode !== null) throw new Error(`Local Convex exited before becoming ready (exit ${convex?.exitCode})`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the disposable local Convex deployment')
}

function startConvex(worktree) {
  return new Promise((resolve, reject) => {
    convex = spawn(pnpm, ['exec', 'convex', 'dev', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], {
      cwd: worktree,
      env: { ...inheritedEnv, CONVEX_AGENT_MODE: 'anonymous' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const observe = chunk => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
      if (output.includes('Convex functions ready!')) resolve()
    }
    convex.stdout.on('data', observe)
    convex.stderr.on('data', chunk => {
      const text = chunk.toString()
      output += text
      process.stderr.write(text)
      if (output.includes('Convex functions ready!')) resolve()
    })
    convex.once('error', reject)
    convex.once('exit', code => reject(new Error(`Local Convex exited before functions were ready (exit ${code ?? 'signal'})`)))
  })
}

async function main() {
  const workspace = await mkdtemp(join(tmpdir(), 'budds-learn-v2-e2e-'))
  isolatedRoot = join(workspace, 'app')
  await execFile('git', ['worktree', 'add', '--detach', isolatedRoot, 'HEAD'], { cwd: root })
  await symlink(join(root, 'node_modules'), join(isolatedRoot, 'node_modules'), 'dir')

  await execFile(pnpm, ['exec', 'convex', 'dev', '--once', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], {
    cwd: isolatedRoot,
    env: { ...inheritedEnv, CONVEX_AGENT_MODE: 'anonymous' },
    maxBuffer: 8 * 1024 * 1024,
  })
  const convexUrl = assertLoopbackUrl(parseEnv(await readFile(join(isolatedRoot, '.env.local'), 'utf8'), 'VITE_CONVEX_URL'), 'Convex local deployment URL')
  const localConfig = JSON.parse(await readFile(join(isolatedRoot, '.convex/local/default/config.json'), 'utf8'))
  const convexSiteUrl = assertLoopbackUrl(`http://127.0.0.1:${localConfig.ports.site}`, 'Convex local site URL')
  const functionEnv = join(isolatedRoot, '.env.learn-v2-e2e-functions')
  await writeFile(functionEnv, [
    'NODE_ENV=test',
    'BUDDS_E2E_MODE=true',
    `BUDDS_E2E_AUTH_TOKEN=${token}`,
    'LEARN_V2_ENABLED=true',
    'LEARN_V2_BLUEPRINT_PROVIDER_ENABLED=true',
    'LEARN_V2_BLUEPRINT_MODEL=budds-e2e-fixture.v1',
    'LEARN_V2_SESSION_CONTENT_PROVIDER_ENABLED=true',
    'LEARN_V2_SESSION_CONTENT_MODEL=budds-e2e-fixture.v1',
    'LEARN_V2_CALIBRATION_MODEL=budds-e2e-fixture.v1',
    'LEARN_V2_MASTERY_MODEL=budds-e2e-fixture.v1',
    `SITE_URL=${baseUrl}`,
    `NUXT_PUBLIC_SITE_URL=${baseUrl}`,
    `CONVEX_SITE_URL=${convexSiteUrl}`,
    '',
  ].join('\n'))
  await execFile(pnpm, ['exec', 'convex', 'env', 'set', '--from-file', functionEnv, '--force'], { cwd: isolatedRoot, env: { ...inheritedEnv, CONVEX_AGENT_MODE: 'anonymous' } })
  await startConvex(isolatedRoot)
  await waitForLocalConvex(isolatedRoot)

  nuxt = spawn(pnpm, ['exec', 'nuxt', 'dev', '--host', '127.0.0.1', '--port', new URL(baseUrl).port || '3102'], {
    cwd: root,
    env: { ...inheritedEnv, NODE_ENV: 'test', BUDDS_E2E_MODE: 'true', BUDDS_E2E_AUTH_TOKEN: token, LEARN_V2_ENABLED: 'true', CONVEX_URL: convexUrl, NUXT_PUBLIC_CONVEX_URL: convexUrl, AUTH_PROXY_TARGET_URL: convexSiteUrl, CONVEX_SITE_URL: convexSiteUrl, NUXT_PUBLIC_SITE_URL: baseUrl, SITE_URL: baseUrl },
    stdio: 'inherit',
  })
  nuxt.once('exit', code => { void cleanup().finally(() => process.exit(code ?? 1)) })
}

main().catch(async (error) => {
  await cleanup()
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
