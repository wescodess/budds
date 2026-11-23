import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from '../../convex/lib/learnV2ScorerConfig'
import { serializeCompletionRequest } from './ai-gateway'
import { buildBaselineMasteryScoringPayload, buildBaselineMasteryScoringRequest, parseBaselineMasteryScoringResponse, scorerDigest } from './learn-v2-mastery-scorer'
import { LEARN_MEASUREMENT_RUBRIC_SCORER_VERSION, learnMeasurementRubricScoringProtocol } from './learn-v2-measurement-rubric-scorer'

test('measurement stimulus requests have a distinct pinned identity and preserve the baseline parser, threshold and automatic routing', async () => {
  const baselineDefinition = { configurationId: 'fixture.baseline.v1', configurationVersion: 'fixture.config.v1', kind: 'legacy_baseline' as const,
    requestedModel: 'fixture/model', endpoint: null, identity: { mappingVersion: 'fixture.identity.v1', canonicalModel: 'fixture/model',
      family: 'fixture', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const measurementDefinition = { ...baselineDefinition, configurationId: 'fixture.measurement.v1', kind: 'measurement_rubric' as const }
  const baseline = await sealLearnScorerConfiguration(baselineDefinition)
  const measurement = await sealLearnScorerConfiguration(measurementDefinition)
  expect(measurement.binding.configurationDigest).not.toBe(baseline.binding.configurationDigest)
  expect(baseline.binding.scorerVersion).toBe('learn-v2.mastery-scorer.v1')
  expect(measurement.binding.scorerVersion).toBe(LEARN_MEASUREMENT_RUBRIC_SCORER_VERSION)
  expect(measurement.binding.promptVersion).not.toBe(baseline.binding.promptVersion)
  for (const key of ['parserVersion', 'responseSchemaVersion', 'thresholdVersion', 'thresholdPercent', 'transitionVersion', 'routingMode', 'endpoint', 'requestedModel'] as const) expect(measurement.binding[key]).toBe(baseline.binding[key])
  const frozen = JSON.parse(measurement.frozenConfiguration.snapshot)
  expect(frozen.components.measurementRubricImplementation).toBe(await scorerDigest(await readFile(new URL('./learn-v2-measurement-rubric-scorer.ts', import.meta.url), 'utf8')))
  const original = JSON.parse(baseline.frozenConfiguration.snapshot)
  expect(original.components).not.toHaveProperty('measurementRubricImplementation')
  expect(original.components).not.toHaveProperty('payloadVersion')
  const registry = await createLearnScorerRegistry({ epoch: 'fixture.epoch.v1', configurations: [
    { definition: baselineDefinition, expectedDigest: baseline.binding.configurationDigest },
    { definition: measurementDefinition, expectedDigest: measurement.binding.configurationDigest },
  ], legacyAllowlist: [baselineDefinition.configurationId], prospectiveConfigurationId: null })
  expect(await registry.verifySaved(baseline)).toEqual(baseline)
  expect(await registry.verifySaved(measurement)).toEqual(measurement)
  await expect(registry.verifySaved({ ...measurement, binding: { ...measurement.binding, configurationDigest: baseline.binding.configurationDigest } })).rejects.toThrow()
  await expect(createLearnScorerRegistry({ epoch: 'fixture.epoch.v1', configurations: [{ definition: measurementDefinition, expectedDigest: measurement.binding.configurationDigest }],
    legacyAllowlist: [measurementDefinition.configurationId], prospectiveConfigurationId: null })).rejects.toThrow('closed baseline allowlist')
})

test.each([null, '  Hypothetical givens: groups=3, size=5.\n私🙂  '])('declared stimulus survives request serialization exactly: %s', declaredStimulus => {
  const input = { rubric: { version: 'rubric.v1', criteria: [{ key: 'rule', description: 'Apply the rule.', weightPercent: 100 }] },
    challenge: 'Apply the rule to the declared givens.', declaredStimulus, evidence: [{ alias: 'S1', claim: 'The source rule.', excerpt: 'A source rule.' }], learnerResponse: 'My answer.' }
  const signal = new AbortController().signal
  const request = learnMeasurementRubricScoringProtocol.request('fixture/model', input, signal)
  const body = JSON.parse(serializeCompletionRequest(request))
  expect(JSON.parse(body.messages[1].content).declaredStimulus).toBe(declaredStimulus)
  expect(learnMeasurementRubricScoringProtocol.read(body.messages[1].content)).toEqual(input)
  const { declaredStimulus: _stimulus, ...baselineInput } = input
  expect(buildBaselineMasteryScoringPayload(input)).toBe(buildBaselineMasteryScoringPayload(baselineInput))
  const baseline = buildBaselineMasteryScoringRequest('fixture/model', buildBaselineMasteryScoringPayload(baselineInput), signal)
  expect(JSON.parse(serializeCompletionRequest(baseline)).messages).not.toEqual(body.messages)
  expect(request.jsonSchema).toEqual(baseline.jsonSchema)
  expect(learnMeasurementRubricScoringProtocol.parse).toBe(parseBaselineMasteryScoringResponse)
})
