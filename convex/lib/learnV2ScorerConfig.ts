import { LEARN_MEASUREMENT_ITEM_LIMITS } from '../../shared/learn-v2-measurement-item-limits'
import { LearnScoringProtocolError } from '../../shared/learn-v2-errors'
import { z } from 'zod'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../../shared/adaptive-v2-pilot-policy'
import { learnScorerBindingSchema, LEARN_V2_SCORER_IDENTITY_POLICY_VERSION, type LearnScorerBinding } from '../../shared/learn-v2-measurement'
import { learnDigestSchema, learnTextSchema, learnVersionSchema } from '../../shared/learn-v2-responses'
import { baselineMasteryScoringArtifacts, scorerCanonicalJson, scorerDigest } from '../../server/utils/learn-v2-mastery-scorer'
import { LEARN_MEASUREMENT_RUBRIC_SCORER_VERSION, measurementRubricScoringArtifacts } from '../../server/utils/learn-v2-measurement-rubric-scorer'

// Server-only inventory. There are deliberately no admitted production entries.
// Construct this registry from reviewed inventory, never from a request/model override.
const definitionSchema = z.strictObject({
  configurationId: learnVersionSchema, configurationVersion: learnVersionSchema,
  kind: z.enum(['legacy_baseline', 'strict_prospective', 'measurement_rubric']), requestedModel: learnTextSchema(200),
  endpoint: learnTextSchema(200).nullable(),
  identity: z.strictObject({
    mappingVersion: learnVersionSchema, canonicalModel: learnTextSchema(200).nullable(),
    family: learnTextSchema(200).nullable(), snapshotAssurance: z.enum(['unknown', 'documented_snapshot']),
    verifiedReturnedModels: z.array(learnTextSchema(200)).max(16)
      .refine(values => new Set(values).size === values.length),
  }),
}).refine(value => value.kind !== 'strict_prospective' ? value.endpoint === null : value.endpoint !== null && /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:/-]+$/.test(value.endpoint),
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
  currentParser: 'sha256:1924207e432ed6b18383a3d0e0ddb0475394c3206e073ecd7e8277fd52079d7a',
  arithmeticAndTransition: 'sha256:2a4f659d03832281753f0ccab5fc3b0f6136745c733f437ecc0c6e05ad6505aa',
  executionGuard: 'sha256:67515dec4b35050c4edb03496c2099423eb9a2d58e4cfdaa48a992539c774d10',
  gatewayResponseReader: 'sha256:f440402f86ee4f3259c7370755c29329319db3119b1a03994e33b6f3cc5fdbe5',
  gatewaySerializer: 'sha256:d88eb19ad882397b5263e9d2404934385586b513809010ac08aa5fc60e198583',
  gatewayProvenance: 'sha256:1762159ae5f545a1c3052797fc008201fe1460e368c4c4ee6ce1e604eef39b7d',
  gatewayTransport: 'sha256:84c6b88235df95cb7dbb105e5d5d5294fdafc72c53cc471e262d23a068cf729a',
  gatewayErrorPolicy: 'sha256:b89071d7935dbad60988177cee2dcbb0cf5d6ea9ad6df76e8e2fb622aab1b945',
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
  const measurement = definition.kind === 'measurement_rubric'
  const artifacts = measurement ? await measurementRubricScoringArtifacts() : await baselineMasteryScoringArtifacts()
  const scorerVersion = measurement ? LEARN_MEASUREMENT_RUBRIC_SCORER_VERSION : 'learn-v2.mastery-scorer.v1'
  const snapshot = scorerCanonicalJson({
    schemaVersion: 'learn-v2.scorer-configuration.v1', ...definition,
    transportVersion: 'openrouter-via-cloudflare-ai-gateway.v2', apiVersion: 'openrouter.chat-completions.v1',
    routing: { mode: definition.kind !== 'strict_prospective' ? 'legacy_auto' : 'strict', endpoint: definition.endpoint, allowFallbacks: false },
    components: { ...artifacts, implementation: LEARN_MASTERY_IMPLEMENTATION_PINS,
      inputContract: { version: 'learn-v2.measurement-item-contract.v1', ...LEARN_MEASUREMENT_ITEM_LIMITS },
      ...(measurement ? { measurementRubricImplementation: 'sha256:503a0a18f7fa8d3fc0161dcf7b38f357fdb010736f961bcf0299106c01ce0586' } : {}),
      scorerVersion, parserVersion: 'learn-v2.mastery-parser.v2', guardVersion: 'learn-v2.scoring-receipt-guard.v3' },
    threshold: { version: 'learn-v2.mastery-threshold.v1', percent: 80, comparator: 'gte', transitionVersion: 'learn-v2.mastery-transition.v1' },
    limits: ADAPTIVE_V2_PILOT_MANIFEST.limits,
    metadata: { version: 'learn-v2.scoring-provenance.v1', enabled: true, maxLookups: 1, timeoutMs: 10_000 },
  })
  const digest = await scorerDigest(snapshot)
  const binding = learnScorerBindingSchema.parse({
    kind: 'model', configurationId: definition.configurationId, configurationVersion: definition.configurationVersion,
    configurationDigest: digest, requestedModel: definition.requestedModel,
    routingMode: definition.kind !== 'strict_prospective' ? 'legacy_auto' : 'strict', endpoint: definition.endpoint,
    scorerVersion, promptVersion: artifacts.promptVersion,
    responseSchemaVersion: artifacts.responseSchemaVersion, parserVersion: 'learn-v2.mastery-parser.v2',
    guardVersion: 'learn-v2.scoring-receipt-guard.v3', thresholdVersion: 'learn-v2.mastery-threshold.v1',
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
    || new Set(input.legacyAllowlist).size !== input.legacyAllowlist.length) throw new LearnScoringProtocolError('Invalid scorer inventory')
  const definitions = input.configurations.map(value => definitionSchema.parse(value.definition))
  const entries = await Promise.all(definitions.map(sealLearnScorerConfiguration))
  if (entries.some((entry, index) => entry.binding.configurationDigest !== learnDigestSchema.parse(input.configurations[index]!.expectedDigest))) throw new LearnScoringProtocolError('Scorer configuration differs from its reviewed digest')
  if (new Set(entries.map(entry => entry.binding.configurationId)).size !== entries.length) throw new LearnScoringProtocolError('Scorer configuration IDs are immutable')
  const legacy = entries.filter(entry => input.legacyAllowlist.includes(entry.binding.configurationId))
  if (legacy.length !== input.legacyAllowlist.length || legacy.some(entry => JSON.parse(entry.frozenConfiguration.snapshot).kind !== 'legacy_baseline')
    || new Set(legacy.map(entry => entry.binding.requestedModel)).size !== legacy.length) throw new LearnScoringProtocolError('Invalid closed baseline allowlist')
  const prospective = entries.find(entry => entry.binding.configurationId === input.prospectiveConfigurationId)
  if (input.prospectiveConfigurationId !== null && prospective?.binding.routingMode !== 'strict') throw new LearnScoringProtocolError('Invalid prospective scorer configuration')
  const identityPolicy = freeze({
    version: LEARN_V2_SCORER_IDENTITY_POLICY_VERSION,
    verifiedModelAliases: entries.flatMap((entry, index) => definitions[index]!.identity.verifiedReturnedModels.map(returnedModel => ({
      configurationDigest: entry.binding.configurationDigest, requestedModel: entry.binding.requestedModel, returnedModel,
    }))),
  })
  if (identityPolicy.verifiedModelAliases.length > 16) throw new LearnScoringProtocolError('Scorer alias policy exceeds its ceiling')
  return Object.freeze({
    epoch, identityPolicy,
    // Resolution is only for assignment. Execution/retry/reconciliation use verifySaved.
    resolveNew(input: { kind: 'legacy_published', publishedContent: { providerModel: string, requestSettingsDigest: string } } | { kind: 'prospective' }) {
      if (input.kind === 'prospective') {
        if (!prospective) throw new LearnScoringProtocolError('Prospective scorer is unavailable')
        return prospective
      }
      const entry = legacy.find(entry => entry.binding.requestedModel === input.publishedContent.providerModel)
      if (!entry || JSON.parse(entry.frozenConfiguration.snapshot).components.requestSettingsDigest !== input.publishedContent.requestSettingsDigest) throw new LearnScoringProtocolError('Published scorer is outside the closed baseline inventory')
      return entry
    },
    async verifySaved(saved: BoundLearnScorerConfiguration) {
      const binding = learnScorerBindingSchema.parse(saved.binding)
      if (binding.kind !== 'model') throw new LearnScoringProtocolError('Model scorer binding required')
      const entry = entries.find(entry => entry.binding.configurationId === binding.configurationId)
      if (!entry || scorerCanonicalJson(entry.binding) !== scorerCanonicalJson(binding)
        || entry.frozenConfiguration.snapshot !== saved.frozenConfiguration.snapshot
        || saved.frozenConfiguration.digest !== binding.configurationDigest
        || await scorerDigest(saved.frozenConfiguration.snapshot) !== binding.configurationDigest) throw new LearnScoringProtocolError('Saved scorer configuration is unavailable or mismatched')
      const current = await sealLearnScorerConfiguration(definitions[entries.indexOf(entry)]!)
      if (current.frozenConfiguration.snapshot !== entry.frozenConfiguration.snapshot) throw new LearnScoringProtocolError('Scorer implementation changed after binding')
      return entry
    },
  })
}

export async function resolveMasteryScorerBinding(registry: LearnScorerRegistry,
  input: { saved: BoundLearnScorerConfiguration } | Parameters<LearnScorerRegistry['resolveNew']>[0]) {
  return 'saved' in input ? registry.verifySaved(input.saved) : registry.resolveNew(input)
}
