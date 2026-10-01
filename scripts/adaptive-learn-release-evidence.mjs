import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))
const sourcePaths = {
  storage_manifest: 'shared/adaptive-learn-storage-manifest.ts', schema: 'convex/schema.ts',
  export: 'convex/dataExport.ts', deletion: 'convex/accountDeletion.ts', migration: 'convex/migrations.ts',
  storage_checks: 'shared/adaptive-learn-storage-manifest.test.ts', migration_checks: 'convex/migrations.test.ts',
  export_checks: 'convex/dataExport.test.ts', deletion_checks: 'convex/accountDeletion.test.ts', object_deletion_checks: 'convex/accountDeletion.r2Boundary.test.ts',
  events: 'shared/learn-adaptive-events.ts', first_value_metrics: 'shared/learn-adaptive-metrics.ts', operational_metrics: 'shared/learn-adaptive-operational-metrics.ts', outcome_metrics: 'shared/learn-adaptive-outcome-metrics.ts',
  operational_query: 'scripts/adaptive-learn-metrics.mjs', outcome_query: 'scripts/adaptive-learn-outcomes.mjs',
  provider_policy: 'shared/adaptive-v2-pilot-policy.ts', provider_controls: 'docs/operations/adaptive-provider-controls.v1.md',
  configuration_approval: 'docs/operations/adaptive-learn-activation-approval.v1.json', configuration_contract: 'shared/adaptive-activation-approval.ts',
}
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, maxBuffer: 2 * 1024 * 1024, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
const validVersion = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value)
const sourcesAt = sha => Object.entries(sourcePaths).sort(([a], [b]) => a < b ? -1 : 1).map(([source, path]) => {
  let bytes
  try {
    bytes = git(['cat-file', 'blob', `${sha}:${path}`])
  }
  catch { return { source, path, digest: null, versions: {}, versionLiterals: [], versionStatus: 'unavailable' } }
  const text = bytes.toString('utf8')
  const declared = [...text.matchAll(/^export const ([A-Z_]*VERSION) = '([^'\r\n]*)'/gm)].map(match => [match[1], match[2]])
  let invalidVersion = declared.some(([, value]) => !validVersion(value))
  const versions = Object.fromEntries(declared.filter(([, value]) => validVersion(value)))
  // Literal labels are a bounded inventory, not evaluated exports or exhaustive semantic claims.
  const labels = [...text.matchAll(/'([a-zA-Z0-9_.-]{1,95}\.v[0-9]{1,4})'/g)].map(match => match[1])
  invalidVersion ||= labels.some(value => !validVersion(value))
  const versionLiterals = [...new Set(labels.filter(validVersion))].sort()
  if (path.endsWith('.json')) {
    try {
      const value = JSON.parse(text)
      if (validVersion(value?.version)) versions.version = value.version
      else invalidVersion = true
    }
    catch { invalidVersion = true }
  }
  const versionStatus = invalidVersion ? 'invalid' : Object.keys(versions).length || versionLiterals.length ? 'inventoried' : 'unversioned'
  return { source, path, digest: createHash('sha256').update(bytes).digest('hex'), versions, versionLiterals, versionStatus }
})

const roles = ['release', 'flag', 'rollback', 'support']
const kinds = ['hosted_gate', 'provider_quota', 'provider_configuration', 'keyboard', 'physical_screen_reader', 'wcag_2_2_aa', 'security', 'migration', 'export', 'deletion', 'metric_definitions']
const evidenceSources = {
  hosted_gate: [], provider_quota: ['provider_policy', 'provider_controls'],
  provider_configuration: ['provider_policy', 'configuration_approval', 'configuration_contract'],
  keyboard: [], physical_screen_reader: [], wcag_2_2_aa: [], security: ['schema', 'configuration_contract'],
  migration: ['storage_manifest', 'schema', 'migration', 'migration_checks'],
  export: ['storage_manifest', 'schema', 'export', 'export_checks', 'storage_checks'],
  deletion: ['storage_manifest', 'schema', 'deletion', 'deletion_checks', 'object_deletion_checks', 'storage_checks'],
  metric_definitions: ['events', 'first_value_metrics', 'operational_metrics', 'outcome_metrics', 'operational_query', 'outcome_query'],
}
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value
const canonical = value => JSON.stringify(normalize(value))
const reject = () => { throw new Error('invalid') }
const shape = (value, allowed, required = []) => {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) reject()
}
const token = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value)) reject() }
const shaValue = value => { if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) reject() }
const digestValue = value => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) reject() }
const enumeration = (value, allowed) => { if (!allowed.includes(value)) reject() }
const rows = value => { if (!Array.isArray(value) || value.length > 100) reject() }
const optional = (row, field, validate) => { if (Object.hasOwn(row, field) && row[field] !== null) validate(row[field]) }
const validate = input => {
  shape(input, ['version', 'synthetic', 'owners', 'evidence', 'knownExclusions'], ['version', 'synthetic'])
  if (input.version !== 'adaptive-release-input.v1' || typeof input.synthetic !== 'boolean') reject()
  for (const field of ['owners', 'evidence', 'knownExclusions']) { if (!Object.hasOwn(input, field)) input[field] = []; rows(input[field]) }
  for (const row of input.owners) {
    shape(row, ['role', 'ownerId'], ['role']); enumeration(row.role, roles); optional(row, 'ownerId', token)
  }
  for (const row of input.evidence) {
    shape(row, ['kind', 'testedSha', 'environment', 'result', 'artifactId', 'artifactDigest', 'reviewerId', 'reviewDecision', 'sourceDigests'], ['kind'])
    enumeration(row.kind, kinds); optional(row, 'testedSha', shaValue)
    optional(row, 'environment', value => enumeration(value, ['local', 'synthetic', 'hosted', 'provider', 'physical']))
    optional(row, 'result', value => enumeration(value, ['passed', 'failed', 'unknown']))
    for (const field of ['artifactId', 'reviewerId']) optional(row, field, token)
    optional(row, 'artifactDigest', digestValue)
    optional(row, 'reviewDecision', value => enumeration(value, ['approved', 'pending', 'denied']))
    if (Object.hasOwn(row, 'sourceDigests') && row.sourceDigests !== null) {
      rows(row.sourceDigests)
      for (const pin of row.sourceDigests) { shape(pin, ['source', 'digest'], ['source']); enumeration(pin.source, Object.keys(sourcePaths)); optional(pin, 'digest', digestValue) }
    }
  }
  for (const row of input.knownExclusions) { shape(row, ['code', 'subject', 'ownerId'], ['code', 'subject']); token(row.code); token(row.subject); optional(row, 'ownerId', token) }
}
const readInput = async path => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    if (!(await handle.stat()).isFile()) reject()
    const buffer = Buffer.alloc(65537)
    let length = 0
    while (length < buffer.length) { const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null); if (!bytesRead) break; length += bytesRead }
    if (length > 65536) reject()
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)))
  }
  finally { await handle.close() }
}
const sortedUnique = values => [...new Map(values.map(value => [canonical(value), value])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value)
const assemble = (input, sha, sources) => {
  const owners = sortedUnique(input.owners.map(row => ({ role: row.role, ownerId: row.ownerId ?? null })))
  const evidence = sortedUnique(input.evidence.map(row => ({ ...row, sourceDigests: sortedUnique(row.sourceDigests ?? []) })))
  const exclusions = input.knownExclusions.map(row => ({ ...row, ownerId: row.ownerId ?? null }))
  const exclude = (code, subject) => exclusions.push({ code, subject, ownerId: null })
  for (const source of sources) if (source.digest === null) exclude('missing_source', source.source)
  for (const source of sources) if (source.versionStatus === 'invalid') exclude('invalid_source_version', source.source)
  for (const role of roles) {
    const candidates = owners.filter(row => row.role === role)
    if (!candidates.length || candidates.some(row => row.ownerId === null)) exclude('missing_owner', role)
    if (candidates.length > 1) exclude('conflicting_owner', role)
  }
  for (const kind of kinds) {
    const candidates = evidence.filter(row => row.kind === kind)
    if (!candidates.length) exclude('missing_evidence', kind)
    if (candidates.length > 1) exclude('conflicting_evidence', kind)
    for (const row of candidates) {
      for (const field of ['testedSha', 'environment', 'result', 'artifactId', 'artifactDigest', 'reviewerId', 'reviewDecision']) if (row[field] == null) exclude('incomplete_evidence', `${kind}.${field}`)
      if (row.testedSha != null && row.testedSha !== sha) exclude('sha_mismatch', kind)
      const environment = ['provider_quota', 'provider_configuration'].includes(kind) ? 'provider' : kind === 'physical_screen_reader' ? 'physical' : ['hosted_gate', 'keyboard', 'wcag_2_2_aa', 'security'].includes(kind) ? 'hosted' : 'local'
      if (row.environment != null && row.environment !== environment) exclude('environment_mismatch', kind)
      if (row.result != null && row.result !== 'passed') exclude('evidence_not_passed', kind)
      if (row.reviewDecision != null && row.reviewDecision !== 'approved') exclude('review_not_approved', kind)
      for (const source of evidenceSources[kind]) if (!row.sourceDigests.some(pin => pin.source === source && pin.digest != null)) exclude('missing_source_pin', `${kind}.${source}`)
      for (const pin of row.sourceDigests) {
        if (row.sourceDigests.filter(other => other.source === pin.source).length > 1) exclude('conflicting_source_pin', `${kind}.${pin.source}`)
        if (pin.digest == null) exclude('missing_source_pin', `${kind}.${pin.source}`)
        else if (sources.find(source => source.source === pin.source)?.digest !== pin.digest) exclude('source_digest_mismatch', `${kind}.${pin.source}`)
      }
    }
  }
  const knownExclusions = sortedUnique(exclusions)
  return { version: 'adaptive-release-evidence.v1', testedSha: sha, synthetic: input.synthetic, assemblyComplete: knownExclusions.length === 0, activationReady: false, activationDecision: 'denied', reviewStatus: 'unverified', sources, owners, evidence, knownExclusions }
}

try {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0] !== '--sha' || args[2] !== '--input') reject()
  const [, sha, , path] = args
  shaValue(sha)
  if (git(['rev-parse', '--verify', `${sha}^{commit}`]).toString('utf8').trim() !== sha) reject()
  const input = await readInput(path)
  validate(input)
  const sources = sourcesAt(sha)
  console.log(canonical(assemble(input, sha, sources)))
}
catch {
  console.error('Adaptive Learn release evidence input rejected')
  process.exitCode = 1
}
