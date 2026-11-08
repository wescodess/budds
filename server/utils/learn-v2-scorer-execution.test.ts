import { readFile } from 'node:fs/promises'
import { describe, expect, test, vi } from 'vitest'
import type { Id } from '../../convex/_generated/dataModel'
import { createLearnScorerRegistry, LEARN_MASTERY_IMPLEMENTATION_PINS, resolveMasteryScorerBinding, sealLearnScorerConfiguration, type LearnScorerConfigurationDefinition } from '../../convex/lib/learnV2ScorerConfig'
import { isLearnScoringReceiptCommittable, learnScoringExecutionReceiptSchema } from '../../shared/learn-v2-measurement'
import { deriveMastery, scoreCriteria } from '../../shared/learn-v2-mastery'
import { baselineMasteryScoringArtifacts, buildBaselineMasteryScoringRequest, createLearnMasteryScorerService, scorerCanonicalJson, scorerDigest } from './learn-v2-mastery-scorer'
import { generateCompletion, serializeCompletionRequest, type GenerateParams, type GatewayGenerationMetadata } from './ai-gateway'

const definition = (configurationId = 'fixture.legacy.v1', requestedModel = 'fixture/old-model'): LearnScorerConfigurationDefinition => ({
  configurationId, configurationVersion: 'fixture.config.v1', kind: 'legacy_baseline', requestedModel, endpoint: null,
  identity: { mappingVersion: 'fixture.identity.v1', canonicalModel: requestedModel, family: 'fixture', snapshotAssurance: 'unknown', verifiedReturnedModels: [] },
})
const strict = (configurationId = 'fixture.strict.v1', endpoint = 'fixture-provider/region-variant'): LearnScorerConfigurationDefinition => ({
  ...definition(configurationId), kind: 'strict_prospective', endpoint,
})
const scoringInput = () => ({
  rubric: { version: 'fixture.rubric.v1', criteria: [{ key: 'core', description: 'Apply the rule.', weightPercent: 79 },
    { key: 'boundary', description: 'State the boundary.', weightPercent: 1 }, { key: 'units', description: 'Use the unit.', weightPercent: 20 }] },
  challenge: 'Apply the source rule.', evidence: [{ alias: 'S1', claim: 'The rule applies within the stated boundary.', excerpt: 'A synthetic source rule.' }],
  learnerResponse: 'The rule applies with this boundary and unit.',
})
const vector = { criterionResults: [{ key: 'core', awarded: true }, { key: 'boundary', awarded: false }, { key: 'units', awarded: true }], misconceptionTags: [] }
function completion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gen-fixture', model: 'fixture/old-model',
    choices: [{ index: 0, message: { role: 'assistant' as const, content: JSON.stringify(vector) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, cost: 0.001 },
    openrouter_metadata: { requested: 'fixture/old-model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Fixture Provider', model: 'fixture/old-model', selected: true }] }, pipeline: [] },
    ...overrides,
  }
}
const metadata = (overrides: Partial<GatewayGenerationMetadata> = {}): GatewayGenerationMetadata => ({
  generationId: 'gen-fixture', returnedModel: 'fixture/old-model', servingProvider: 'Fixture Provider', upstreamRequestId: 'upstream-fixture',
  finishReason: 'stop', nativeFinishReason: 'stop', cancelled: false, usage: null, ...overrides,
})

// Synthetic registry pins only. Real entries must carry reviewed saved digests,
// rather than regenerating expected digests during production registration.
const registered = (definitions: LearnScorerConfigurationDefinition[]) => Promise.all(definitions.map(async definition => ({
  definition, expectedDigest: (await sealLearnScorerConfiguration(definition)).binding.configurationDigest,
})))

async function setup(options: { definitions?: LearnScorerConfigurationDefinition[], selected?: string, response?: ReturnType<typeof completion> } = {}) {
  const definitions = options.definitions ?? [definition()]
  const registry = await createLearnScorerRegistry({ epoch: 'fixture.epoch.v1', configurations: await registered(definitions),
    legacyAllowlist: definitions.filter(row => row.kind === 'legacy_baseline').map(row => row.configurationId),
    prospectiveConfigurationId: definitions.find(row => row.kind === 'strict_prospective')?.configurationId ?? null })
  const saved = await sealLearnScorerConfiguration(definitions.find(row => row.configurationId === options.selected) ?? definitions[0]!)
  let now = 10_000
  const infer = vi.fn(async (_request: GenerateParams) => options.response ?? completion())
  const lookup = vi.fn(async (_id: string, _signal: AbortSignal) => metadata())
  const service = createLearnMasteryScorerService(registry, { infer, metadata: lookup }, () => now)
  const input = { saved, scoringInput: scoringInput(), leaseExpiresAt: now + 300_000, context: {
    assessmentOpportunityId: 'opportunity' as Id<'learnAssessmentOpportunities'>, submissionId: 'submission' as Id<'learnResponses'>,
    jobId: 'job' as Id<'learnJobs'>, dispatchOrdinal: 1, leaseIdentityHash: `sha256:${'a'.repeat(64)}`, dispatchedAt: now,
    responseDigest: `sha256:${'b'.repeat(64)}`,
    assessmentPins: { kind: 'session_application' as const, caseId: 'case' as Id<'learnAssessmentCases'>, promptDigest: 'c'.repeat(64),
      rubricVersion: 'fixture.rubric.v1', rubricDigest: 'd'.repeat(64), supportManifestDigest: 'e'.repeat(64) },
  } }
  const prepared = await service.prepare(input)
  return { registry, saved, service, input, prepared, infer, lookup, setNow: (value: number) => { now = value }, clock: () => now }
}

describe('closed immutable scorer inventory', () => {
  test('binds old effective published models and settings; no implicit generation-model admission', async () => {
    const { registry } = await setup({ definitions: [definition(), definition('fixture.older.v1', 'fixture/older-model')] })
    const settings = await baselineMasteryScoringArtifacts()
    const resolve = (providerModel: string, requestSettingsDigest = settings.requestSettingsDigest) => resolveMasteryScorerBinding(registry,
      { kind: 'legacy_published', publishedContent: { providerModel, requestSettingsDigest } })
    expect((await resolve('fixture/older-model')).binding.requestedModel).toBe('fixture/older-model')
    expect(JSON.parse((await resolve('fixture/old-model')).frozenConfiguration.snapshot).kind).toBe('legacy_baseline')
    await expect(resolve('fixture/new-generator')).rejects.toThrow('closed baseline inventory')
    await expect(resolve('fixture/old-model', 'a'.repeat(64))).rejects.toThrow('closed baseline inventory')
  })

  test('saved opportunities survive changed generator/default and epoch allowlist without repinning', async () => {
    const original = await setup()
    const registry = await createLearnScorerRegistry({ epoch: 'fixture.epoch.v2', configurations: await registered([definition(), strict()]),
      legacyAllowlist: [], prospectiveConfigurationId: 'fixture.strict.v1' })
    expect((await resolveMasteryScorerBinding(registry, { saved: original.saved }))).toEqual(original.saved)
    expect((await resolveMasteryScorerBinding(registry, { kind: 'prospective' })).binding.routingMode).toBe('strict')
    expect(Object.isFrozen(original.saved.binding)).toBe(true)
  })

  test('strict endpoint configurations have distinct digests, and base provider selectors are rejected', async () => {
    const legacy = await sealLearnScorerConfiguration(definition())
    const first = await sealLearnScorerConfiguration(strict())
    const second = await sealLearnScorerConfiguration(strict('fixture.strict.v2', 'fixture-provider/another-region'))
    expect(new Set([legacy.binding.configurationDigest, first.binding.configurationDigest, second.binding.configurationDigest]).size).toBe(3)
    await expect(sealLearnScorerConfiguration(strict('fixture.invalid.v1', 'fixture-provider'))).rejects.toThrow()
  })

  test('duplicate IDs, unknown inventory and configuration/binding/snapshot edits fail closed', async () => {
    await expect(createLearnScorerRegistry({ epoch: 'fixture.epoch', configurations: await registered([definition(), definition()]), legacyAllowlist: [], prospectiveConfigurationId: null })).rejects.toThrow('immutable')
    const pinned = await registered([definition()])
    pinned[0]!.definition.requestedModel = 'fixture/unreviewed-replacement'
    await expect(createLearnScorerRegistry({ epoch: 'fixture.epoch', configurations: pinned, legacyAllowlist: ['fixture.legacy.v1'], prospectiveConfigurationId: null })).rejects.toThrow('reviewed digest')
    const { registry, saved } = await setup()
    for (const edited of [
      { ...saved, binding: { ...saved.binding, requestedModel: 'fixture/replacement' } },
      { ...saved, binding: { ...saved.binding, configurationId: 'fixture.unknown.v1' } },
      { ...saved, binding: { ...saved.binding, promptVersion: 'fixture.changed.v2' } },
      { ...saved, frozenConfiguration: { ...saved.frozenConfiguration, snapshot: saved.frozenConfiguration.snapshot + ' ' } },
    ]) await expect(registry.verifySaved(edited)).rejects.toThrow()
  })

  test('implementation pins cover unchanged payload/request/parser and arithmetic/transition bytes', async () => {
    const source = await readFile(new URL('./learn-v2-mastery-scorer.ts', import.meta.url), 'utf8')
    for (const [key, name] of [['payloadBuilder', 'buildBaselineMasteryScoringPayload'], ['requestBuilder', 'buildBaselineMasteryScoringRequest'], ['parser', 'parseBaselineMasteryScoringResponse']] as const) {
      const start = source.indexOf(`export function ${name}`)
      expect(await scorerDigest(source.slice(start, source.indexOf('\n}', start) + 2))).toBe(LEARN_MASTERY_IMPLEMENTATION_PINS[key])
    }
    expect(await scorerDigest(await readFile(new URL('../../shared/learn-v2-mastery.ts', import.meta.url), 'utf8'))).toBe(LEARN_MASTERY_IMPLEMENTATION_PINS.arithmeticAndTransition)
    expect(await scorerDigest(source.slice(source.indexOf('export function scorerCanonicalJson')))).toBe(LEARN_MASTERY_IMPLEMENTATION_PINS.executionGuard)
    const gateway = await readFile(new URL('./ai-gateway.ts', import.meta.url), 'utf8')
    const serializerStart = gateway.indexOf('export function serializeCompletionRequest')
    expect(await scorerDigest(gateway.slice(serializerStart, gateway.indexOf('\n}', serializerStart) + 2))).toBe(LEARN_MASTERY_IMPLEMENTATION_PINS.gatewaySerializer)
    expect(await scorerDigest(gateway.slice(gateway.indexOf('export function validateGenerateResponse'), gateway.indexOf('\ntype GatewayRuntimeConfig')))).toBe(LEARN_MASTERY_IMPLEMENTATION_PINS.gatewayProvenance)
    expect(await scorerDigest(gateway.slice(gateway.indexOf('export function generateCompletion('), gateway.indexOf('\nexport async function generateCompletionStream')))).toBe(LEARN_MASTERY_IMPLEMENTATION_PINS.gatewayTransport)
  })
})

describe('recorded execution verification', () => {
  test('preserves baseline request bytes/automatic routing while opting in to observations', async () => {
    const { prepared, service, infer, registry } = await setup()
    const result = await service.dispatch(prepared)
    const request = infer.mock.calls[0]![0]
    const original = buildBaselineMasteryScoringRequest('fixture/old-model', request.messages[1]!.content, request.signal!)
    expect(serializeCompletionRequest(request)).toBe(serializeCompletionRequest(original))
    expect(request.providerOrder).toBeUndefined()
    expect(request.captureScoringProvenance).toBe(true)
    expect(request).toMatchObject({ temperature: 0, max_tokens: 1200, maxAttempts: 1, allowProviderFallbacks: false,
      collectLogPayload: false, requireZeroDataRetention: true, denyProviderDataCollection: true, skipGatewayCache: true })
    expect(result.receipt.requestDigest).toBe(await scorerDigest(serializeCompletionRequest(request)))
    expect(result.receipt.requestBytes).toBe(new TextEncoder().encode(serializeCompletionRequest(request)).byteLength)
    expect(result.receipt.verdict?.scorePercent).toBe(99)
    expect(isLearnScoringReceiptCommittable(result.receipt, registry.identityPolicy)).toBe(true)
    expect(result.receipt.observedIdentity).toMatchObject({ status: 'verified', requestedScorerModel: 'fixture/old-model', returnedScorerModel: 'fixture/old-model',
      generationId: 'gen-fixture', servingProvider: 'Fixture Provider', upstreamRequestId: null, endpoint: null, revision: null, fingerprint: null })
    expect(result.receipt.usage).toEqual({ inputTokens: 120, outputTokens: 40, costMicroUsd: 1000 })
    expect(JSON.stringify(result)).not.toContain(scoringInput().learnerResponse)
    expect(JSON.stringify(result)).not.toContain(scoringInput().evidence[0]!.excerpt)
    expect(await service.isConsumable(prepared, structuredClone(result))).toBe(true)
    const tampered = structuredClone(result)
    tampered.receipt.verdict!.scorePercent = 100
    expect(await service.isConsumable(prepared, tampered)).toBe(false)
    expect(scorerCanonicalJson(result.receipt.verdict!.criterionResults)).toBe(scorerCanonicalJson(vector.criterionResults))
    await expect(service.dispatch(prepared)).rejects.toThrow('unavailable')
    expect(infer).toHaveBeenCalledTimes(1)
  })

  test('keeps the 80 comparator and deterministic arithmetic unchanged', () => {
    expect(scoreCriteria(scoringInput().rubric.criteria, vector.criterionResults)).toBe(99)
    for (const scorePercent of [79, 80, 81]) expect(deriveMastery({ scorePercent, assisted: false, kind: 'independent_application' }).state)
      .toBe(scorePercent >= 80 ? 'independent' : 'needs_review')
  })

  test.each([
    ['selected provider differs from successful attempt', 'Fixture Provider', [{ provider: 'Another Provider', model: 'fixture/old-model', status: 200 }], 'mismatch'],
    ['successful attempts disagree on provider', 'Fixture Provider', [
      { provider: 'Fixture Provider', model: 'fixture/old-model', status: 200 },
      { provider: 'Another Provider', model: 'fixture/old-model', status: 200 },
    ], 'mismatch'],
    ['successful attempt provider is missing', 'Fixture Provider', [{ model: 'fixture/old-model', status: 200 }], 'unknown'],
    ['selected provider is missing', undefined, [{ provider: 'Fixture Provider', model: 'fixture/old-model', status: 200 }], 'unknown'],
  ])('%s cannot be consumed', async (_name, provider, attempts, status) => {
    const response = completion({ openrouter_metadata: { requested: 'fixture/old-model', strategy: 'direct', attempt: attempts.length,
      ...(provider ? { endpoints: { available: [{ provider, model: 'fixture/old-model', selected: true }] } } : {}), attempts, pipeline: [] } })
    const { service, prepared, registry, infer, lookup } = await setup({ response })
    const result = await service.dispatch(prepared)
    expect(result.receipt.observedIdentity.status).toBe(status)
    expect(result.receipt.outcome).toBe('reconciliation_required')
    expect(result.receipt.verdict).toBeUndefined()
    expect(isLearnScoringReceiptCommittable(result.receipt, registry.identityPolicy)).toBe(false)
    expect(await service.isConsumable(prepared, result)).toBe(false)
    expect(infer).toHaveBeenCalledTimes(1)
    expect(lookup).not.toHaveBeenCalled()
  })

  test('consistent selected and successful attempt providers remain consumable', async () => {
    const response = completion()
    const { service, prepared, registry } = await setup({ response: completion({ openrouter_metadata: {
      ...response.openrouter_metadata, attempts: [{ provider: 'Fixture Provider', model: 'fixture/old-model', status: 200 }],
    } }) })
    const result = await service.dispatch(prepared)
    expect(result.receipt.observedIdentity.status).toBe('verified')
    expect(result.receipt.outcome).toBe('validated')
    expect(isLearnScoringReceiptCommittable(result.receipt, registry.identityPolicy)).toBe(true)
    expect(await service.isConsumable(prepared, result)).toBe(true)
  })

  test('strict routing sends one exact selector, but the selector/provider/request ID never attest the endpoint', async () => {
    const { prepared, service, infer, registry } = await setup({ definitions: [strict()] })
    const result = await service.dispatch(prepared)
    const body = JSON.parse(serializeCompletionRequest(infer.mock.calls[0]![0]))
    expect(body.provider).toMatchObject({ order: ['fixture-provider/region-variant'], only: ['fixture-provider/region-variant'], allow_fallbacks: false })
    const reconciled = await service.reconcile(prepared, result)
    expect(reconciled.receipt.observedIdentity).toMatchObject({ status: 'unknown', endpoint: null, upstreamRequestId: 'upstream-fixture' })
    expect(isLearnScoringReceiptCommittable(reconciled.receipt, registry.identityPolicy)).toBe(false)
  })

  test('only explicit configuration-scoped verified aliases may match', async () => {
    const aliasDefinition = definition()
    aliasDefinition.identity.verifiedReturnedModels = ['fixture/canonical-snapshot']
    const good = await setup({ definitions: [aliasDefinition], response: completion({ model: 'fixture/canonical-snapshot' }) })
    expect((await good.service.dispatch(good.prepared)).receipt.outcome).toBe('validated')
    const bad = await setup({ response: completion({ model: 'fixture/canonical-snapshot' }) })
    const result = await bad.service.dispatch(bad.prepared)
    expect(result.receipt.observedIdentity.status).toBe('mismatch')
    expect(result.receipt.verdict).toBeUndefined()
  })

  test('Today/Canvas consumers execute their original binding after a prospective default change', async () => {
    const original = await setup()
    const changed = await createLearnScorerRegistry({ epoch: 'fixture.next-epoch', configurations: await registered([definition(), strict()]),
      legacyAllowlist: [], prospectiveConfigurationId: 'fixture.strict.v1' })
    const infer = vi.fn(async (_request: GenerateParams) => completion())
    const service = createLearnMasteryScorerService(changed, { infer, metadata: vi.fn() }, original.clock)
    for (const entry of ['today', 'canvas']) {
      const prepared = await service.prepare({ ...original.input, context: { ...original.input.context,
        assessmentOpportunityId: `opportunity-${entry}` as Id<'learnAssessmentOpportunities'> } })
      expect((await service.dispatch(prepared)).receipt.outcome).toBe('validated')
    }
    expect(infer.mock.calls.every(([request]) => request.model === 'fixture/old-model' && request.providerOrder === undefined)).toBe(true)
  })

  test.each([
    ['unknown model', { model: 'fixture/unknown-alias' }],
    ['conflicting provider', { provider: 'Another Provider' }],
    ['missing provider', { openrouter_metadata: undefined }],
    ['fallback', { openrouter_metadata: { strategy: 'fallback', attempt: 2 } }],
    ['pipeline transformation', { openrouter_metadata: { strategy: 'direct', attempt: 1, pipeline: [{ type: 'response_healing', data: { private: 'body' } }] } }],
    ['malformed metadata', { openrouter_metadata: { attempt: 'one' } }],
    ['truncation', { choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: JSON.stringify(vector) } }] }],
    ['native truncation', { choices: [{ index: 0, finish_reason: 'stop', native_finish_reason: 'MAX_TOKENS', message: { role: 'assistant', content: JSON.stringify(vector) } }] }],
    ['missing terminal status', { choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(vector) } }] }],
    ['refusal', { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null, refusal: 'private refusal' } }] }],
    ['filtered', { choices: [{ index: 0, finish_reason: 'content_filter', message: { role: 'assistant', content: JSON.stringify(vector) } }] }],
    ['provider error', { error: { message: 'private upstream error' } }],
  ])('%s remains unscored', async (_name, overrides) => {
    const { service, prepared, registry, infer } = await setup({ response: completion(overrides) })
    const result = await service.dispatch(prepared)
    expect(result.receipt.outcome).not.toBe('validated')
    expect(result.receipt.verdict).toBeUndefined()
    expect(isLearnScoringReceiptCommittable(result.receipt, registry.identityPolicy)).toBe(false)
    expect(infer).toHaveBeenCalledTimes(1)
  })

  test.each([
    'not JSON', '{}', JSON.stringify({ ...vector, extra: true }),
    JSON.stringify({ ...vector, criterionResults: vector.criterionResults.slice(1) }),
    JSON.stringify({ ...vector, criterionResults: [...vector.criterionResults, vector.criterionResults[0]] }),
    JSON.stringify({ ...vector, criterionResults: vector.criterionResults.map(row => ({ ...row, key: 'unknown' })) }),
    JSON.stringify({ ...vector, misconceptionTags: ['unknown'] }),
    JSON.stringify({ ...vector, misconceptionTags: ['unsupported_claim', 'unsupported_claim'] }),
  ])('rejects malformed or incomplete terminal vectors: %s', async content => {
    const { service, prepared } = await setup({ response: completion({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] }) })
    const result = await service.dispatch(prepared)
    expect(result.receipt.outcome).toBe('reconciliation_required')
    expect(result.receipt.verdict).toBeUndefined()
  })

  test('reconciliation uses only the saved generation ID, including after service restart', async () => {
    const { service, prepared, infer, input, registry, clock, setNow } = await setup({ response: completion({ openrouter_metadata: undefined, usage: undefined }) })
    const result = await service.dispatch(prepared)
    expect(result.receipt.outcome).toBe('reconciliation_required')
    expect(result.receipt.usage).toBeNull()
    setNow(clock() + 10_000)
    const lookup = vi.fn(async () => metadata())
    const restarted = createLearnMasteryScorerService(registry, { infer, metadata: lookup }, clock)
    const restored = await restarted.prepare(input)
    const reconciled = await restarted.reconcile(restored, structuredClone(result))
    expect(lookup).toHaveBeenCalledWith('gen-fixture', expect.any(AbortSignal))
    expect(infer).toHaveBeenCalledTimes(1)
    expect(reconciled.receipt.outcome).toBe('validated')
    expect(await restarted.isConsumable(restored, structuredClone(reconciled))).toBe(true)
    expect(reconciled.receipt.observedIdentity).toMatchObject({ observationSource: 'openrouter.generation-metadata', upstreamRequestId: 'upstream-fixture' })
    await expect(restarted.dispatch(restored)).rejects.toThrow('unavailable')
    await expect(restarted.reconcile(restored, reconciled)).rejects.toThrow('unavailable')
  })

  test.each([
    { generationId: 'gen-other' }, { returnedModel: 'fixture/replacement' }, { finishReason: 'length' }, { cancelled: true },
  ])('rejects contradictory generation metadata %j without inference', async changes => {
    const { service, prepared, lookup, infer } = await setup({ response: completion({ openrouter_metadata: undefined }) })
    const saved = await service.dispatch(prepared)
    lookup.mockResolvedValueOnce(metadata(changes))
    const result = await service.reconcile(prepared, saved)
    expect(result.receipt.outcome).not.toBe('validated')
    expect(result.receipt.verdict).toBeUndefined()
    expect(infer).toHaveBeenCalledTimes(1)
  })

  test('metadata failure consumes its one lookup and never retries inference', async () => {
    const { service, prepared, lookup, infer } = await setup({ response: completion({ openrouter_metadata: undefined }) })
    const saved = await service.dispatch(prepared)
    lookup.mockRejectedValueOnce(new Error('Private metadata error'))
    const result = await service.reconcile(prepared, saved)
    expect(result.metadataLookups).toBe(1)
    await expect(service.reconcile(prepared, result)).rejects.toThrow('unavailable')
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(infer).toHaveBeenCalledTimes(1)
  })

  test('a missing inline model preserves its generation ID for metadata reconciliation', async () => {
    const { service, prepared, infer } = await setup({ response: completion({ model: undefined, openrouter_metadata: undefined }) })
    const result = await service.dispatch(prepared)
    expect(result.receipt.observedIdentity).toMatchObject({ returnedScorerModel: null, generationId: 'gen-fixture' })
    const reconciled = await service.reconcile(prepared, result)
    expect(reconciled.receipt.outcome).toBe('validated')
    expect(infer).toHaveBeenCalledTimes(1)
  })

  test('concurrent dispatch is denied, and a transport ignoring abort still hits the finite deadline', async () => {
    const { service, prepared, input, infer } = await setup()
    const second = await service.prepare(input)
    infer.mockImplementationOnce(() => new Promise(() => {}))
    vi.useFakeTimers()
    try {
      const pending = service.dispatch(prepared)
      await vi.waitFor(() => expect(infer).toHaveBeenCalledTimes(1))
      await expect(service.dispatch(second)).rejects.toThrow('unavailable')
      await vi.advanceTimersByTimeAsync(90_000)
      const result = await pending
      expect(result.receipt.outcome).toBe('reconciliation_required')
      expect(result.terminal.failure).toBe('outcome_unknown')
      expect(infer.mock.calls[0]![0].signal!.aborted).toBe(true)
      await expect(service.dispatch(prepared)).rejects.toThrow('unavailable')
      expect(infer).toHaveBeenCalledTimes(1)
    }
    finally { vi.useRealTimers() }
  })

  test('ambiguous dispatches stay unscored, with no redispatch', async () => {
    const { service, prepared, infer, lookup } = await setup()
    infer.mockRejectedValueOnce(new Error('private learner response from upstream'))
    const result = await service.dispatch(prepared)
    expect(result.terminal.failure).toBe('outcome_unknown')
    expect(result.receipt.outcome).toBe('reconciliation_required')
    expect(JSON.stringify(result)).not.toContain('private learner')
    await expect(service.dispatch(prepared)).rejects.toThrow('unavailable')
    await expect(service.reconcile(prepared, result)).rejects.toThrow('unavailable')
    expect(infer).toHaveBeenCalledTimes(1)
    expect(lookup).not.toHaveBeenCalled()
  })

  test('A11 scoring redirect rejection stays unscored with no redispatch or metadata lookup', async () => {
    const { registry, input, lookup, clock } = await setup()
    vi.stubGlobal('useRuntimeConfig', () => ({ cloudflareAccountId: 'synthetic-account', cloudflareAiGatewayId: 'synthetic-gateway', openrouterApiKey: 'synthetic-only' }))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed', { cause: new Error('unexpected redirect') }))
    try {
      const service = createLearnMasteryScorerService(registry, { infer: generateCompletion, metadata: lookup }, clock)
      const prepared = await service.prepare(input)
      const result = await service.dispatch(prepared)
      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST', redirect: 'error' }))
      expect(result.terminal).toEqual({ generationId: null, returnedModel: null, provenance: null, verdict: null, outputDigest: null, failure: 'outcome_unknown' })
      expect(result.receipt.outcome).toBe('reconciliation_required')
      expect(result.receipt.verdict).toBeUndefined()
      expect(await service.isConsumable(prepared, result)).toBe(false)
      await expect(service.dispatch(prepared)).rejects.toThrow('unavailable')
      await expect(service.reconcile(prepared, result)).rejects.toThrow('unavailable')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(lookup).not.toHaveBeenCalled()
    }
    finally { fetchMock.mockRestore(); vi.unstubAllGlobals() }
  })

  test('expired leases, dispatch ceilings, private/oversized payloads and edited settings block I/O', async () => {
    const { service, input, prepared, infer, setNow } = await setup()
    await expect(service.prepare({ ...input, leaseExpiresAt: input.leaseExpiresAt + 1 })).rejects.toThrow('finite')
    await expect(service.prepare({ ...input, context: { ...input.context, dispatchOrdinal: 3 } })).rejects.toThrow('finite')
    await expect(service.prepare({ ...input, scoringInput: { ...input.scoringInput, learnerResponse: 'person@example.com' } })).rejects.toThrow('privacy')
    await expect(service.prepare({ ...input, scoringInput: { ...input.scoringInput, learnerResponse: 'x'.repeat(48_000) } })).rejects.toThrow()
    prepared.request.temperature = 0.5
    await expect(service.dispatch(prepared)).rejects.toThrow('integrity')
    expect(infer).not.toHaveBeenCalled()
    const fresh = await service.prepare(input)
    setNow(input.leaseExpiresAt)
    await expect(service.dispatch(fresh)).rejects.toThrow('unavailable')
    expect(infer).not.toHaveBeenCalled()
  })

  test('late terminal results and swapped reconciliation artifacts cannot become consumable', async () => {
    const { service, input, prepared, infer, setNow, registry } = await setup()
    infer.mockImplementationOnce(async () => { setNow(input.leaseExpiresAt); return completion() })
    const result = await service.dispatch(prepared)
    expect(result.receipt.integrityResult).toBe('lease_expired')
    expect(isLearnScoringReceiptCommittable(result.receipt, registry.identityPolicy)).toBe(false)
    const missing = await setup({ response: completion({ openrouter_metadata: undefined }) })
    const saved = await missing.service.dispatch(missing.prepared)
    saved.terminal.verdict!.criterionResults[0]!.awarded = false
    await expect(missing.service.reconcile(missing.prepared, saved)).rejects.toThrow('unavailable')
    expect(learnScoringExecutionReceiptSchema.safeParse(result.receipt).success).toBe(true)
  })
})
