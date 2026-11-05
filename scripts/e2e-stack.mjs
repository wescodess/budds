import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildNuxt, loadNuxt, writeTypes } from 'nuxt/kit'
import { cleanupStack, createStartupOutput, ensureDisposableLearner, redactStartupOutput, spawnOwnedChild, stopChild, waitForConvexReady, waitForPortsClosed } from './e2e-stack-runtime.mjs'

const execFile = promisify(execFileCallback)
const root = process.cwd()
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const token = process.env.BUDDS_E2E_AUTH_TOKEN || 'e2e-local-token-please-do-not-use-outside-tests'
const baseUrl = assertLoopbackUrl(process.env.BUDDS_E2E_BASE_URL || 'http://127.0.0.1:3102', 'BUDDS_E2E_BASE_URL')
const realAdaptiveCanvas = process.env.BUDDS_E2E_REAL_ADAPTIVE_CANVAS === 'true'
const syntheticApproval = process.env.BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL === 'true'

if (process.env.NODE_ENV === 'production' || process.env.CONVEX_DEPLOY_KEY || process.env.CF_PAGES_ENVIRONMENT) throw new Error('E2E stack refuses production mode, Cloudflare Pages environments, and Convex deploy keys')
if (process.env.BUDDS_E2E_CONVEX_URL) throw new Error('BUDDS_E2E_CONVEX_URL is unsupported: the runner creates its own disposable local Convex deployment')
if (token.length < 32) throw new Error('BUDDS_E2E_AUTH_TOKEN must contain at least 32 characters')
if (syntheticApproval && !realAdaptiveCanvas) throw new Error('Synthetic Adaptive approval requires the real local Adaptive Canvas journey')
if (syntheticApproval && ['CONVEX_DEPLOYMENT_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN'].some(key => process.env[key])) throw new Error('Synthetic approval refuses deployment credentials')

const inheritedEnv = { ...process.env }
for (const key of ['CONVEX_DEPLOYMENT', 'CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN', 'CONVEX_URL', 'CONVEX_SITE_URL', 'NUXT_PUBLIC_CONVEX_URL', 'AUTH_PROXY_TARGET_URL']) Reflect.deleteProperty(inheritedEnv, key)

let isolatedRoot
let workspace
let convex
let nuxt
let builder
let cleaned = false
let cleanupPromise
let convexPorts = []
let stage = 'creating disposable checkout'
const secrets = new Set([token, ...Object.entries(inheritedEnv).filter(([key]) => /SECRET|TOKEN|KEY|PASSWORD/.test(key)).map(([, value]) => value)])

async function run(label, command, args, options) {
  stage = label
  const output = createStartupOutput(secrets)
  try {
    return await new Promise((resolve, reject) => {
      const child = execFileCallback(command, args, options, (error, stdout, stderr) => {
        output.finish()
        if (error) reject(error)
        else resolve({ stdout, stderr })
      })
      for (const stream of ['stdout', 'stderr']) child[stream]?.on('data', chunk => output.write(stream, chunk))
    })
  } catch (error) {
    output.finish()
    const details = output.diagnostics || redactStartupOutput(error.message, secrets)
    throw new Error(`${label} failed (exit ${error.code ?? 'unknown'}):\n${details}`, { cause: error })
  }
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleaned = true
  cleanupPromise = cleanupStack({
    server: nuxt, backend: convex, ports: convexPorts, builder,
    removeWorktree: isolatedRoot ? () => execFile('git', ['worktree', 'remove', '--force', isolatedRoot], { cwd: root }) : undefined,
    removeWorkspace: workspace ? () => rm(workspace, { recursive: true, force: true }) : undefined,
  }).then(errors => {
    for (const { label, error } of errors) console.error(`E2E cleanup failed while ${label}: ${redactStartupOutput(error.message, secrets)}`)
    return errors.length
  })
  return cleanupPromise
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
      if (await fetch(`${localUrl}/instance_name`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok).catch(() => false)) return localUrl
    }
    if (convex?.commandExited || convex?.exitCode !== null || convex?.signalCode !== null) throw new Error('Local Convex exited before becoming ready')
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the disposable local Convex deployment')
}

function startConvex(worktree) {
  stage = 'starting disposable Convex'
  convex = spawnOwnedChild(pnpm, ['exec', 'convex', 'dev', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], {
    cwd: worktree,
    env: { ...inheritedEnv, CONVEX_AGENT_MODE: 'anonymous' },
  })
  return waitForConvexReady(convex, secrets, (stream, text) => process[stream].write(text))
}

async function main() {
  workspace = await mkdtemp(join(tmpdir(), 'budds-learn-v2-e2e-'))
  isolatedRoot = join(workspace, 'app')
  await run('creating disposable checkout', 'git', ['worktree', 'add', '--detach', isolatedRoot, 'HEAD'], { cwd: root })
  await symlink(join(root, 'node_modules'), join(isolatedRoot, 'node_modules'), 'dir')

  await run('initializing disposable Convex', pnpm, ['exec', 'convex', 'dev', '--once', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], {
    cwd: isolatedRoot,
    env: { ...inheritedEnv, CONVEX_AGENT_MODE: 'anonymous' },
    maxBuffer: 8 * 1024 * 1024,
  })
  const convexUrl = assertLoopbackUrl(parseEnv(await readFile(join(isolatedRoot, '.env.local'), 'utf8'), 'VITE_CONVEX_URL'), 'Convex local deployment URL')
  const localConfig = JSON.parse(await readFile(join(isolatedRoot, '.convex/local/default/config.json'), 'utf8'))
  convexPorts = [localConfig.ports.cloud, localConfig.ports.site]
  if (localConfig.adminKey) secrets.add(localConfig.adminKey)
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
    ...(syntheticApproval ? ['BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL=true', 'LEARN_ADAPTIVE_V2_PILOT_MANIFEST=adaptive-v2-pilot.v1'] : []),
    `SITE_URL=${baseUrl}`,
    `NUXT_PUBLIC_SITE_URL=${baseUrl}`,
    `CONVEX_SITE_URL=${convexSiteUrl}`,
    '',
  ].join('\n'))
  await run('configuring disposable Convex', pnpm, ['exec', 'convex', 'env', 'set', '--from-file', functionEnv, '--force'], { cwd: isolatedRoot, env: { ...inheritedEnv, CONVEX_AGENT_MODE: 'anonymous' } })
  const learner = syntheticApproval ? JSON.parse(await readFile(join(root, 'e2e/fixtures/adaptive-v2-learner.json'), 'utf8')) : undefined
  if (learner) secrets.add(learner.password)
  await startConvex(isolatedRoot)
  await waitForLocalConvex(isolatedRoot)
  if (syntheticApproval) {
    stage = 'authenticating disposable learner'
    const subject = await ensureDisposableLearner(convexSiteUrl, baseUrl, learner)
    const learnerHash = `sha256:${createHash('sha256').update(JSON.stringify(['adaptive-v2-pilot-cohort.v1', `${convexSiteUrl}|${subject}`])).digest('hex')}`
    stage = 'stopping disposable Convex for synthetic approval'
    await stopChild(convex)
    await waitForPortsClosed(convexPorts)
    const result = await run('configuring synthetic approval', process.execPath, [join(root, 'scripts/configure-e2e-synthetic-pilot.mjs'), '--root', isolatedRoot, '--app-url', baseUrl, '--convex-url', convexUrl, '--learner-hash', learnerHash], {
      cwd: root, env: { ...inheritedEnv, NODE_ENV: 'test', BUDDS_E2E_MODE: 'true', BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL: 'true' },
    })
    const artifact = JSON.parse(result.stdout)
    console.log(`Disposable synthetic Adaptive approval: ${artifact.label}; actual provider cost $0; expires ${artifact.endsAt}`)
    await startConvex(isolatedRoot)
    await waitForLocalConvex(isolatedRoot)
  }

  stage = 'building Nuxt'
  const appEnv = { ...inheritedEnv, NODE_ENV: 'test', BUDDS_E2E_MODE: 'true', BUDDS_E2E_BASE_URL: baseUrl, BUDDS_E2E_AUTH_TOKEN: token, LEARN_V2_ENABLED: 'true', CONVEX_URL: convexUrl, NUXT_PUBLIC_CONVEX_URL: convexUrl, AUTH_PROXY_TARGET_URL: convexSiteUrl, CONVEX_SITE_URL: convexSiteUrl, NUXT_PUBLIC_SITE_URL: baseUrl, SITE_URL: baseUrl }
  Object.assign(process.env, appEnv)
  const outputDir = join(workspace, 'output')
  // Build the real entry and lazy routes before exposing HTTP readiness. A dev
  // optimizer can discover imports mid-hydration and invalidate loaded modules.
  // The programmatic build preserves NODE_ENV=test for disposable E2E admission;
  // dev:false still bundles the client and SSR instead of running a Vite server.
  builder = await loadNuxt({
    cwd: root,
    dev: false,
    dotenv: false,
    overrides: {
      extends: [realAdaptiveCanvas ? './e2e/authority-layer' : './e2e/canvas-layer'],
      nitro: { preset: 'node-server', output: { dir: outputDir } },
    },
  })
  // Match the CLI's preparation step and use the project's .nuxt directory:
  // tsconfig.json and server/tsconfig.json extend generated files there.
  await writeTypes(builder)
  await buildNuxt(builder)
  const built = builder
  builder = undefined
  await built.close()
  const port = new URL(baseUrl).port || '3102'
  const serverEnv = { ...appEnv, HOST: '127.0.0.1', PORT: port, NITRO_HOST: '127.0.0.1', NITRO_PORT: port }
  // Nitro's own endpoint settings take precedence over HOST and PORT.
  for (const key of ['NITRO_UNIX_SOCKET', 'NITRO_SSL_CERT', 'NITRO_SSL_KEY']) Reflect.deleteProperty(serverEnv, key)
  stage = 'starting built Nuxt'
  nuxt = spawnOwnedChild(process.execPath, [join(outputDir, 'server/index.mjs')], {
    cwd: root,
    env: serverEnv,
  })
  nuxt.stdout.pipe(process.stdout)
  nuxt.stderr.pipe(process.stderr)
  nuxt.once('error', error => { console.error(`Nuxt failed to start: ${redactStartupOutput(error.message, secrets)}`); void cleanup().finally(() => process.exit(1)) })
  nuxt.once('commandExit', code => { if (!cleaned) void cleanup().then(errors => process.exit(errors ? 1 : (code ?? 1))) })
  nuxt.once('close', () => { if (!cleaned) void cleanup().finally(() => process.exit(1)) })
}

main().catch(async (error) => {
  console.error(`E2E stack failed while ${stage}: ${redactStartupOutput(error instanceof Error ? error.message : error, secrets)}`)
  await cleanup()
  process.exit(1)
})
