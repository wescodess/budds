import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'

const run = promisify(execFile)
const root = resolve('.')
const cli = resolve('scripts/configure-e2e-synthetic-pilot.mjs')

test('the synthetic approval CLI refuses an ordinary working checkout without modifying production policy', async () => {
  const policy = resolve('shared/adaptive-v2-pilot-policy.ts')
  const before = await readFile(policy, 'utf8')
  await expect(run(process.execPath, [cli, '--root', root, '--app-url', 'http://127.0.0.1:3102', '--convex-url', 'http://127.0.0.1:3210'], {
    env: { ...process.env, NODE_ENV: 'test', BUDDS_E2E_MODE: 'true', BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL: 'true' },
  })).rejects.toMatchObject({ stderr: expect.stringMatching(/refuses.*disposable detached worktree/i) })
  expect(await readFile(policy, 'utf8')).toBe(before)
})

test('only a detached disposable local deployment can receive the synthetic fixture, with shipped approval still denied', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'budds-learn-v2-e2e-'))
  const target = join(workspace, 'app')
  const original = await readFile(resolve('shared/adaptive-v2-pilot-policy.ts'), 'utf8')
  const env = { ...process.env, NODE_ENV: 'test', BUDDS_E2E_MODE: 'true', BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL: 'true', SITE_URL: 'http://127.0.0.1:3102', CONVEX_CLOUD_URL: 'http://127.0.0.1:3210' }
  try {
    await run('git', ['worktree', 'add', '--detach', target, 'HEAD'], { cwd: root })
    await mkdir(join(target, '.convex/local/default'), { recursive: true })
    await writeFile(join(target, '.convex/local/default/config.json'), JSON.stringify({ ports: { cloud: 3210, site: 3211 } }))
    await writeFile(join(target, '.env.local'), 'VITE_CONVEX_URL=http://127.0.0.1:3210\n')
    const args = [cli, '--root', target, '--app-url', env.SITE_URL, '--convex-url', env.CONVEX_CLOUD_URL]
    for (const overrides of [{ NODE_ENV: 'production' }, { BUDDS_E2E_MODE: 'false' }, { BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL: 'false' }, { CONVEX_DEPLOYMENT_TOKEN: 'not-a-real-token' }, { CF_PAGES_ENVIRONMENT: 'production' }]) {
      await expect(run(process.execPath, args, { env: { ...env, ...overrides } })).rejects.toMatchObject({ stderr: expect.stringMatching(/refuses/i) })
      expect(await readFile(join(target, 'shared/adaptive-v2-pilot-policy.ts'), 'utf8')).toBe(original)
    }
    await expect(run(process.execPath, [...args.slice(0, 4), 'https://example.com', ...args.slice(5)], { env })).rejects.toMatchObject({ stderr: expect.stringMatching(/refuses.*non-loopback/i) })
    const fixturePath = join(target, 'e2e/fixtures/adaptive-v2-synthetic-approval.ts')
    // A checked-in fixture exists after this commit; remove only this exact
    // disposable path to exercise the approved filesystem boundary.
    await unlink(fixturePath).catch(() => undefined)
    await symlink(resolve('shared/adaptive-v2-pilot-policy.ts'), fixturePath)
    await expect(run(process.execPath, args, { env })).rejects.toMatchObject({ stderr: expect.stringMatching(/refuses.*symlink/i) })
    expect(await readFile(resolve('shared/adaptive-v2-pilot-policy.ts'), 'utf8')).toBe(original)
    await unlink(fixturePath)
    const result = JSON.parse((await run(process.execPath, args, { env })).stdout)
    expect(result).toMatchObject({ label: 'disposable-test-only-synthetic-approval', actualProviderCostUsd: 0, version: 'adaptive-v2-pilot.v1' })
    expect(Date.parse(result.endsAt) - Date.parse(result.startsAt)).toBe(3_600_000)
    const injected = await readFile(join(target, 'shared/adaptive-v2-pilot-policy.ts'), 'utf8')
    await run(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--allowImportingTsExtensions', '--types', 'node', '--typeRoots', resolve('node_modules/@types'), join(target, 'shared/adaptive-v2-pilot-policy.ts')], { cwd: root })
    await run(process.execPath, args, { env })
    expect(await readFile(join(target, 'shared/adaptive-v2-pilot-policy.ts'), 'utf8')).toBe(injected)
    const input = { model: 'budds-e2e-fixture.v1', now: Date.now(), learnerHash: `sha256:${'a'.repeat(64)}`, activityContractVersion: 'learn-adaptive.activity-contract.v1', evaluationContractVersion: 'learn-adaptive.evaluation.v1' }
    const evaluate = async (overrides: NodeJS.ProcessEnv, model = input.model, now = input.now) => JSON.parse((await run(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `import { adaptiveV2PilotDecision as decision, ADAPTIVE_V2_PILOT_MANIFEST as manifest } from ${JSON.stringify(join(target, 'shared/adaptive-v2-pilot-policy.ts'))}; console.log(JSON.stringify({decision:decision('adaptive-v2-pilot.v1',${JSON.stringify({ ...input, model, now })}),manifest}));`], { env: { ...env, ...overrides } })).stdout)
    const allowed = await evaluate({})
    expect(allowed.decision).toEqual({ allowed: true })
    expect(allowed.manifest.modelPolicies).toEqual([{ model: 'budds-e2e-fixture.v1', inputUsdPerMillionTokens: 0.000001, outputUsdPerMillionTokens: 0.000001 }])
    expect(allowed.manifest.cohort.subjectHashes).toEqual([input.learnerHash])
    expect(allowed.manifest.gaApproved).toBe(false)
    for (const overrides of [{ NODE_ENV: 'production' }, { BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL: 'false' }, { CONVEX_CLOUD_URL: 'https://production.convex.cloud' }, { CONVEX_DEPLOY_KEY: 'not-a-real-key' }]) expect((await evaluate(overrides)).decision.allowed).toBe(false)
    expect((await evaluate({}, 'remote/model')).decision.allowed).toBe(false)
    expect((await evaluate({}, input.model, Date.parse(result.endsAt))).decision.allowed).toBe(false)
    const sameInvocation = JSON.parse((await run(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `import {adaptiveV2PilotDecision as decision} from ${JSON.stringify(join(target, 'shared/adaptive-v2-pilot-policy.ts'))}; const input=${JSON.stringify(input)}; const version='adaptive-v2-pilot.v1'; console.log(JSON.stringify([decision(version,input),decision(version,{...input,learnerHash:'sha256:'+'b'.repeat(64)}),decision(version,{...input,model:'remote/model'})]));`], { env })).stdout)
    expect(sameInvocation).toEqual([{ allowed: true }, { allowed: false, code: 'pilot_manifest_not_approved' }, { allowed: false, code: 'pilot_manifest_not_approved' }])
    await expect(run(process.execPath, args, { env: { ...env, CONVEX_DEPLOY_KEY: 'not-a-real-key' } })).rejects.toMatchObject({ stderr: expect.stringMatching(/refuses.*credentials/i) })
    await expect(run(process.execPath, [...args.slice(0, 6), 'http://127.0.0.1:9999'], { env })).rejects.toMatchObject({ stderr: expect.stringMatching(/refuses.*local deployment/i) })
    expect(await readFile(resolve('shared/adaptive-v2-pilot-policy.ts'), 'utf8')).toBe(original)
  } finally {
    await run('git', ['worktree', 'remove', '--force', target], { cwd: root }).catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
  }
}, 30_000)
