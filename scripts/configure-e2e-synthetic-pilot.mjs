import { execFile as execFileCallback } from 'node:child_process'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFile = promisify(execFileCallback)
const refused = message => { throw new Error(`Synthetic approval CLI refuses ${message}`) }

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 6 || args[0] !== '--root' || args[2] !== '--app-url' || args[4] !== '--convex-url') refused('unexpected arguments')
  const environment = process.env
  if (environment.NODE_ENV !== 'test' || environment.BUDDS_E2E_MODE !== 'true'
    || environment.BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL !== 'true') refused('missing explicit test-only configuration')
  if (['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN', 'CF_PAGES_ENVIRONMENT', 'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN'].some(key => environment[key])) refused('deployment credentials or Cloudflare production configuration')
  for (const value of [args[3], args[5]]) {
    let url
    try { url = new URL(value) } catch { refused('a non-loopback application or Convex URL') }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') refused('a non-loopback application or Convex URL')
  }
  const worktree = await realpath(resolve(args[1]))
  const workspace = dirname(worktree)
  if (basename(worktree) !== 'app' || !/^budds-learn-v2-e2e-[A-Za-z0-9]+$/.test(basename(workspace))
    || dirname(workspace) !== await realpath(tmpdir())) refused('a checkout outside the disposable detached worktree')
  if (!(await lstat(join(worktree, '.git'))).isFile()) refused('a checkout outside the disposable detached worktree')
  const branch = await execFile('git', ['symbolic-ref', '--quiet', 'HEAD'], { cwd: worktree }).then(result => result.stdout.trim()).catch(() => null)
  const top = (await execFile('git', ['rev-parse', '--show-toplevel'], { cwd: worktree })).stdout.trim()
  if (branch !== null || await realpath(top) !== worktree) refused('a checkout outside the disposable detached worktree')
  const regular = async relative => {
    const target = join(worktree, relative)
    if (!(await lstat(target)).isFile() || await realpath(target) !== target) refused('a symlink or nonregular target')
    return target
  }
  const envFile = await regular('.env.local')
  const configFile = await regular('.convex/local/default/config.json')
  const actualUrl = (await readFile(envFile, 'utf8')).match(/^VITE_CONVEX_URL=([^\r\n]+)$/m)?.[1]?.trim()
  const localConfig = JSON.parse(await readFile(configFile, 'utf8'))
  if (!actualUrl || new URL(actualUrl).toString() !== new URL(args[5]).toString()
    || !Number.isSafeInteger(localConfig.ports?.cloud) || Number(new URL(args[5]).port) !== localConfig.ports.cloud) refused('a URL outside this worktree local deployment')
  const policyPath = await regular('shared/adaptive-v2-pilot-policy.ts')
  const fixtureDirectory = join(worktree, 'e2e/fixtures')
  if (!(await lstat(fixtureDirectory)).isDirectory() || await realpath(fixtureDirectory) !== fixtureDirectory) refused('a symlink fixture directory')
  const fixturePath = join(fixtureDirectory, 'adaptive-v2-synthetic-approval.ts')
  const existingFixture = await lstat(fixturePath).catch(() => null)
  if (existingFixture && (!existingFixture.isFile() || await realpath(fixturePath) !== fixturePath)) refused('a symlink or nonregular artifact')
  const policy = await readFile(policyPath, 'utf8')
  const marker = '// DISPOSABLE_SYNTHETIC_APPROVAL: never shipped production authority'
  if (policy.includes(marker)) {
    const metadata = policy.match(/\/\/ SYNTHETIC_CONFIGURATION (.+)\n/)
    if (!metadata) refused('an unknown previous injection')
    const configuration = JSON.parse(metadata[1])
    if (configuration.appUrl !== args[3] || configuration.convexUrl !== args[5]) refused('a changed disposable deployment')
    console.log(JSON.stringify(configuration))
    return
  }
  const signature = '): AdaptiveV2PilotDecision {\n'
  if (policy.split(signature).length !== 2 || !policy.includes('pilotApproved: false,')) refused('an unexpected policy source')
  const startsAt = new Date(Date.now() - 60_000).toISOString()
  const configuration = { label: 'disposable-test-only-synthetic-approval', actualProviderCostUsd: 0, accounting: 'SIMULATED positive ledger reserves; no provider spending', version: 'adaptive-v2-pilot.v1', appUrl: args[3], convexUrl: args[5], startsAt, endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString() }
  const fixture = await readFile(fileURLToPath(new URL('../e2e/fixtures/adaptive-v2-synthetic-approval.ts', import.meta.url)), 'utf8')
  await writeFile(fixturePath, fixture)
  const hookConfiguration = { appUrl: configuration.appUrl, convexUrl: configuration.convexUrl, startsAt, endsAt: configuration.endsAt }
  const hook = `${signature}  configureDisposableSyntheticPilot(ADAPTIVE_V2_PILOT_MANIFEST, input, ${JSON.stringify(hookConfiguration)})\n`
  await writeFile(policyPath, `${marker}\n// SYNTHETIC_CONFIGURATION ${JSON.stringify(configuration)}\nimport { configureDisposableSyntheticPilot } from '../e2e/fixtures/adaptive-v2-synthetic-approval.ts'\n${policy.replace(signature, hook)}`)
  console.log(JSON.stringify(configuration))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Synthetic approval CLI failed')
  process.exitCode = 1
})
