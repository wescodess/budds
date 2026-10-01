import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'

const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
const input = () => ({ version: 'adaptive-release-input.v1', synthetic: true, owners: [], evidence: [], knownExclusions: [] })
const run = (value: unknown, selectedSha = sha, script = 'scripts/adaptive-learn-release-evidence.mjs') => {
  const directory = mkdtempSync(join(tmpdir(), 'adaptive-release-'))
  try {
    const path = join(directory, 'input.json')
    writeFileSync(path, JSON.stringify(value))
    return spawnSync(process.execPath, [script, '--sha', selectedSha, '--input', path], { encoding: 'utf8' })
  }
  finally { rmSync(directory, { recursive: true }) }
}

test('operator assembles a reproducible denied bundle naming absent owners and live evidence', () => {
  const first = run(input())
  expect({ status: first.status, stderr: first.stderr }).toEqual({ status: 0, stderr: '' })
  const bundle = JSON.parse(first.stdout)
  expect(bundle).toMatchObject({ version: 'adaptive-release-evidence.v1', testedSha: sha, assemblyComplete: false, activationReady: false, activationDecision: 'denied', reviewStatus: 'unverified' })
  expect(bundle.knownExclusions).toContainEqual({ code: 'missing_owner', subject: 'rollback', ownerId: null })
  expect(bundle.knownExclusions).toContainEqual({ code: 'missing_evidence', subject: 'physical_screen_reader', ownerId: null })
  expect(run(input()).stdout).toBe(first.stdout)
})

test('operator uses an older selected commit even when current committed and dirty sources differ', () => {
  const directory = mkdtempSync(join(tmpdir(), 'adaptive-release-git-'))
  const git = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' })
    expect(result.status).toBe(0)
    return result.stdout.trim()
  }
  try {
    const script = join(directory, 'scripts/adaptive-learn-release-evidence.mjs')
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(script, readFileSync('scripts/adaptive-learn-release-evidence.mjs'))
    for (const source of JSON.parse(run(input()).stdout).sources) {
      const path = join(directory, source.path)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, readFileSync(source.path))
    }
    git(['init', '--quiet'])
    git(['config', 'user.name', 'Synthetic Fixture'])
    git(['config', 'user.email', 'synthetic@example.invalid'])
    git(['add', '.'])
    git(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Synthetic release source fixture'])
    const selected = git(['rev-parse', 'HEAD'])
    const first = run(input(), selected, script)
    expect(first.status).toBe(0)
    writeFileSync(join(directory, 'shared/learn-adaptive-events.ts'), "export const LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION = 'synthetic.events.v99'\n")
    git(['add', '.'])
    git(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Synthetic newer source fixture'])
    const current = git(['rev-parse', 'HEAD'])
    writeFileSync(join(directory, 'shared/learn-adaptive-events.ts'), 'throw new Error("private dirty fixture")\n')
    expect(run(input(), selected, script).stdout).toBe(first.stdout)
    expect(JSON.parse(run(input(), current, script).stdout).sources.find((source: { source: string }) => source.source === 'events').versions).toEqual({ LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION: 'synthetic.events.v99' })
  }
  finally { rmSync(directory, { recursive: true }) }
})

test('operator can assemble complete synthetic metadata but cannot authenticate approval or activate', () => {
  const sources = JSON.parse(run(input()).stdout).sources
  const kinds = ['hosted_gate', 'provider_quota', 'provider_configuration', 'keyboard', 'physical_screen_reader', 'wcag_2_2_aa', 'security', 'migration', 'export', 'deletion', 'metric_definitions']
  const value = {
    ...input(), owners: ['release', 'flag', 'rollback', 'support'].map(role => ({ role, ownerId: `synthetic-${role}` })),
    evidence: kinds.map(kind => ({ kind, testedSha: sha, environment: ['provider_quota', 'provider_configuration'].includes(kind) ? 'provider' : kind === 'physical_screen_reader' ? 'physical' : ['migration', 'export', 'deletion', 'metric_definitions'].includes(kind) ? 'local' : 'hosted', result: 'passed', artifactId: `synthetic-${kind}`, artifactDigest: 'a'.repeat(64), reviewerId: 'synthetic-reviewer', reviewDecision: 'approved', sourceDigests: sources.map((source: { source: string, digest: string }) => ({ source: source.source, digest: source.digest })) })),
  }
  const result = run(value)
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({ synthetic: true, assemblyComplete: true, activationReady: false, activationDecision: 'denied', reviewStatus: 'unverified', knownExclusions: [] })
  const schema = JSON.parse(readFileSync('docs/operations/adaptive-learn-release-evidence.v1.json', 'utf8'))
  expect(schema.$defs.bundle.properties.activationReady).toEqual({ const: false })
  const hosted = value.evidence[0]
  const quota = value.evidence[1]
  if (!hosted || !quota) throw new Error('Synthetic evidence setup missing')
  hosted.environment = 'local'
  expect(JSON.parse(run(value).stdout)).toMatchObject({ assemblyComplete: false, knownExclusions: expect.arrayContaining([{ code: 'environment_mismatch', subject: 'hosted_gate', ownerId: null }]) })
  hosted.environment = 'hosted'
  quota.sourceDigests[0].digest = 'b'.repeat(64)
  expect(JSON.parse(run(value).stdout)).toMatchObject({ assemblyComplete: false, knownExclusions: expect.arrayContaining([{ code: 'source_digest_mismatch', subject: `provider_quota.${sources[0].source}`, ownerId: null }]) })
})

test('operator preserves partial and conflicting metadata as explicit ordered exclusions', () => {
  const value = { ...input(), owners: [{ role: 'release', ownerId: 'synthetic-a' }, { role: 'release', ownerId: 'synthetic-b' }], evidence: [{ kind: 'hosted_gate', testedSha: 'a'.repeat(40), environment: 'local', result: 'passed' }, { kind: 'export' }, { kind: 'security', artifactId: 'synthetic-one' }, { kind: 'security', artifactId: 'synthetic-two' }] }
  const first = run(value)
  expect(first.status).toBe(0)
  const bundle = JSON.parse(first.stdout)
  expect(bundle.knownExclusions).toEqual(expect.arrayContaining([
    { code: 'conflicting_owner', subject: 'release', ownerId: null },
    { code: 'sha_mismatch', subject: 'hosted_gate', ownerId: null },
    { code: 'environment_mismatch', subject: 'hosted_gate', ownerId: null },
    { code: 'incomplete_evidence', subject: 'export.testedSha', ownerId: null },
    { code: 'conflicting_evidence', subject: 'security', ownerId: null },
  ]))
  expect(run({ ...value, owners: [...value.owners].reverse(), evidence: [...value.evidence].reverse() }).stdout).toBe(first.stdout)
})

test('operator traces fixed sources and literal versions to the selected commit', () => {
  const bundle = JSON.parse(run(input()).stdout)
  expect(bundle.sources.find((source: { source: string }) => source.source === 'events')).toMatchObject({ path: 'shared/learn-adaptive-events.ts', versions: { LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION: 'learn-adaptive.activity-events.v6' } })
  expect(bundle.sources.find((source: { source: string }) => source.source === 'events').digest).toBe('2e0e2896ad90663251bedcc13a8a58e3e90f0e08b1e38573889e42864df3d205')
  expect(bundle.sources.map((source: { source: string }) => source.source)).toEqual(expect.arrayContaining(['storage_manifest', 'schema', 'export', 'deletion', 'migration', 'migration_checks', 'export_checks', 'deletion_checks', 'operational_metrics', 'outcome_metrics', 'provider_policy', 'configuration_approval']))
  expect(bundle.sources.find((source: { source: string }) => source.source === 'first_value_metrics').versionLiterals).toContain('first_value.v1')
  expect(bundle.sources.find((source: { source: string }) => source.source === 'outcome_metrics').versionLiterals).toContain('experiment_completion.v1')
})

test('operator rejects unsafe, unknown, malformed and oversized input without exposing its content', () => {
  for (const value of [{ ...input(), rawAnswer: 'private response' }, { ...input(), owners: null }, { ...input(), owners: [{ role: 'release', ownerId: 'https://private.example/secret' }] }, { ...input(), evidence: 'private' }, { ...input(), owners: Array.from({ length: 101 }, () => ({ role: 'release', ownerId: 'owner' })) }, { ...input(), private: 'x'.repeat(65537) }]) {
    const result = run(value)
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn release evidence input rejected\n' })
  }
  for (const invalidSha of ['HEAD', 'A'.repeat(40), `${sha};echo private`, 'f'.repeat(40)]) {
    const result = run(input(), invalidSha)
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn release evidence input rejected\n' })
  }
})

test('operator rejects a nonregular input without waiting for a writer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'adaptive-release-fifo-'))
  try {
    const path = join(directory, 'input.fifo')
    expect(spawnSync('mkfifo', [path]).status).toBe(0)
    const result = spawnSync(process.execPath, ['scripts/adaptive-learn-release-evidence.mjs', '--sha', sha, '--input', path], { encoding: 'utf8', timeout: 2000 })
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn release evidence input rejected\n' })
  }
  finally { rmSync(directory, { recursive: true }) }
})
