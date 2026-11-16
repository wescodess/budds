import { z } from 'zod'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../../shared/adaptive-v2-pilot-policy'
import { learnScorerBindingSchema, LEARN_V2_SCORER_IDENTITY_POLICY_VERSION, type LearnScorerBinding } from '../../shared/learn-v2-measurement'
import { learnDigestSchema, learnTextSchema, learnVersionSchema } from '../../shared/learn-v2-responses'
import { baselineMasteryScoringArtifacts, scorerCanonicalJson, scorerDigest } from '../../server/utils/learn-v2-mastery-scorer'

// Server-only inventory. There are deliberately no admitted production entries.
// Construct this registry from reviewed inventory, never from a request/model override.
const definitionSchema = z.strictObject({
  configurationId: learnVersionSchema, configurationVersion: learnVersionSchema,
  kind: z.enum(['legacy_baseline', 'strict_prospective']), requestedModel: learnTextSchema(200),
  endpoint: learnTextSchema(200).nullable(),
  identity: z.strictObject({
    mappingVersion: learnVersionSchema, canonicalModel: learnTextSchema(200).nullable(),
    family: learnTextSchema(200).nullable(), snapshotAssurance: z.enum(['unknown', 'documented_snapshot']),
    verifiedReturnedModels: z.array(learnTextSchema(200)).max(16)
      .refine(values => new Set(values).size === values.length),
  }),
}).refine(value => value.kind === 'legacy_baseline' ? value.endpoint === null : value.endpoint !== null && /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:/-]+$/.test(value.endpoint),
  'Legacy routing stays automatic; strict routing requires an endpoint')

export type LearnScorerConfigurationDefinition = z.infer<typeof definitionSchema>
export type ModelLearnScorerBinding = Extract<LearnScorerBinding, { kind: 'model' }>
export type BoundLearnScorerConfiguration = {
  binding: ModelLearnScorerBinding
  frozenConfiguration: { digest: string, snapshot: string }
}

export const LEARN_MASTERY_IMPLEMENTATION_PINS = {
  payloadBuilder: 'sha256:98e689a7f70b2c913cf394b5813579cafa177b2322ccc507578c7d3c4751b47d',
  requestBuilder: 'sha256:22e64ce3f359375e689e8bf5affa65d1005be79c3a4e5a1e4b0ea18c20517fbe',
  parser: 'sha256:7d09b0e42c32c0ea6945535bd086c1e322c16094111032670751221081120283',
  arithmeticAndTransition: 'sha256:2a4f659d03832281753f0ccab5fc3b0f6136745c733f437ecc0c6e05ad6505aa',
  executionGuard: 'sha256:8a24e1644ea3418dc834009270196da46ad3f2b6f702e996f0c012290cb79266',
  gatewaySerializer: 'sha256:d88eb19ad882397b5263e9d2404934385586b513809010ac08aa5fc60e198583',
  gatewayProvenance: 'sha256:246a1980938330f4047f0537dc566b4c340aacbd15878d107c2b24abb2c81356',
  gatewayTransport: 'sha256:9eb150d0e36e6b4c8d01129aaa51948ad05d5e3405066cdb89911fec485a8d68',
} as const

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

export async function sealLearnScorerConfiguration(input: LearnScorerConfigurationDefinition): Promise<BoundLearnScorerConfiguration> {
  const definition = definitionSchema.parse(input)
  const artifacts = await baselineMasteryScoringArtifacts()
  const snapshot = scorerCanonicalJson({
    schemaVersion: 'learn-v2.scorer-configuration.v1', ...definition,
    transportVersion: 'openrouter-via-cloudflare-ai-gateway.v1', apiVersion: 'openrouter.chat-completions.v1',
    routing: { mode: definition.kind === 'legacy_baseline' ? 'legacy_auto' : 'strict', endpoint: definition.endpoint, allowFallbacks: false },
    components: { ...artifacts, implementation: LEARN_MASTERY_IMPLEMENTATION_PINS,
      scorerVersion: 'learn-v2.mastery-scorer.v1', parserVersion: 'learn-v2.mastery-parser.v1', guardVersion: 'learn-v2.scoring-receipt-guard.v2' },
    threshold: { version: 'learn-v2.mastery-threshold.v1', percent: 80, comparator: 'gte', transitionVersion: 'learn-v2.mastery-transition.v1' },
    limits: ADAPTIVE_V2_PILOT_MANIFEST.limits,
    metadata: { version: 'learn-v2.scoring-provenance.v1', enabled: true, maxLookups: 1, timeoutMs: 10_000 },
  })
  const digest = await scorerDigest(snapshot)
  const binding = learnScorerBindingSchema.parse({
    kind: 'model', configurationId: definition.configurationId, configurationVersion: definition.configurationVersion,
    configurationDigest: digest, requestedModel: definition.requestedModel,
    routingMode: definition.kind === 'legacy_baseline' ? 'legacy_auto' : 'strict', endpoint: definition.endpoint,
    scorerVersion: 'learn-v2.mastery-scorer.v1', promptVersion: artifacts.promptVersion,
    responseSchemaVersion: artifacts.responseSchemaVersion, parserVersion: 'learn-v2.mastery-parser.v1',
    guardVersion: 'learn-v2.scoring-receipt-guard.v2', thresholdVersion: 'learn-v2.mastery-threshold.v1',
    thresholdPercent: 80, transitionVersion: 'learn-v2.mastery-transition.v1',
  }) as ModelLearnScorerBinding
  return freeze({ binding, frozenConfiguration: { digest, snapshot } })
}

export type LearnScorerRegistry = Awaited<ReturnType<typeof createLearnScorerRegistry>>

export async function createLearnScorerRegistry(input: {
  epoch: string
  configurations: Array<{ definition: LearnScorerConfigurationDefinition, expectedDigest: string }>
  legacyAllowlist: string[]
  prospectiveConfigurationId: string | null
}) {
  const epoch = learnVersionSchema.parse(input.epoch)
  if (input.configurations.length > 32 || input.legacyAllowlist.length > 32
    || new Set(input.legacyAllowlist).size !== input.legacyAllowlist.length) throw new Error('Invalid scorer inventory')
  const definitions = input.configurations.map(value => definitionSchema.parse(value.definition))
  const entries = await Promise.all(definitions.map(sealLearnScorerConfiguration))
  if (entries.some((entry, index) => entry.binding.configurationDigest !== learnDigestSchema.parse(input.configurations[index]!.expectedDigest))) throw new Error('Scorer configuration differs from its reviewed digest')
  if (new Set(entries.map(entry => entry.binding.configurationId)).size !== entries.length) throw new Error('Scorer configuration IDs are immutable')
  const legacy = entries.filter(entry => input.legacyAllowlist.includes(entry.binding.configurationId))
  if (legacy.length !== input.legacyAllowlist.length || legacy.some(entry => entry.binding.routingMode !== 'legacy_auto')
    || new Set(legacy.map(entry => entry.binding.requestedModel)).size !== legacy.length) throw new Error('Invalid closed baseline allowlist')
  const prospective = entries.find(entry => entry.binding.configurationId === input.prospectiveConfigurationId)
  if (input.prospectiveConfigurationId !== null && prospective?.binding.routingMode !== 'strict') throw new Error('Invalid prospective scorer configuration')
  const identityPolicy = freeze({
    version: LEARN_V2_SCORER_IDENTITY_POLICY_VERSION,
    verifiedModelAliases: entries.flatMap((entry, index) => definitions[index]!.identity.verifiedReturnedModels.map(returnedModel => ({
      configurationDigest: entry.binding.configurationDigest, requestedModel: entry.binding.requestedModel, returnedModel,
    }))),
  })
  if (identityPolicy.verifiedModelAliases.length > 16) throw new Error('Scorer alias policy exceeds its ceiling')
  return Object.freeze({
    epoch, identityPolicy,
    // Resolution is only for assignment. Execution/retry/reconciliation use verifySaved.
    resolveNew(input: { kind: 'legacy_published', publishedContent: { providerModel: string, requestSettingsDigest: string } } | { kind: 'prospective' }) {
      if (input.kind === 'prospective') {
        if (!prospective) throw new Error('Prospective scorer is unavailable')
        return prospective
      }
      const entry = legacy.find(entry => entry.binding.requestedModel === input.publishedContent.providerModel)
      if (!entry || JSON.parse(entry.frozenConfiguration.snapshot).components.requestSettingsDigest !== input.publishedContent.requestSettingsDigest) throw new Error('Published scorer is outside the closed baseline inventory')
      return entry
    },
    async verifySaved(saved: BoundLearnScorerConfiguration) {
      const binding = learnScorerBindingSchema.parse(saved.binding)
      if (binding.kind !== 'model') throw new Error('Model scorer binding required')
      const entry = entries.find(entry => entry.binding.configurationId === binding.configurationId)
      if (!entry || scorerCanonicalJson(entry.binding) !== scorerCanonicalJson(binding)
        || entry.frozenConfiguration.snapshot !== saved.frozenConfiguration.snapshot
        || saved.frozenConfiguration.digest !== binding.configurationDigest
        || await scorerDigest(saved.frozenConfiguration.snapshot) !== binding.configurationDigest) throw new Error('Saved scorer configuration is unavailable or mismatched')
      const current = await sealLearnScorerConfiguration(definitions[entries.indexOf(entry)]!)
      if (current.frozenConfiguration.snapshot !== entry.frozenConfiguration.snapshot) throw new Error('Scorer implementation changed after binding')
      return entry
    },
  })
}

export async function resolveMasteryScorerBinding(registry: LearnScorerRegistry,
  input: { saved: BoundLearnScorerConfiguration } | Parameters<LearnScorerRegistry['resolveNew']>[0]) {
  return 'saved' in input ? registry.verifySaved(input.saved) : registry.resolveNew(input)
}
