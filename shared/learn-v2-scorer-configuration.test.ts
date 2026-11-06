import { expect, test } from 'vitest'
import { deriveLearnScorerConfiguration, type LearnScorerBinding } from './learn-v2-measurement'
import { learnReportScorerConfigurationSchema } from './learn-v2-measurement-report'

const deterministic = {
  kind: 'deterministic', engineVersion: 'keyed-scorer.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80,
  transitionVersion: 'learn-v2.mastery-transition.v1',
} as const satisfies LearnScorerBinding
const model = {
  kind: 'model', configurationId: 'configuration.v1', configurationVersion: 'configuration.v1',
  configurationDigest: `sha256:${'a'.repeat(64)}`, requestedModel: 'fixture-model', routingMode: 'legacy_auto', endpoint: null,
  scorerVersion: 'scorer.v1', promptVersion: 'prompt.v1', responseSchemaVersion: 'response.v1', parserVersion: 'parser.v1',
  guardVersion: 'guard.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80, transitionVersion: 'learn-v2.mastery-transition.v1',
} as const satisfies LearnScorerBinding

test('maps a model scorer from its stored digest and version without hashing mutable configuration', async () => {
  const configuration = await deriveLearnScorerConfiguration(Object.freeze(model))
  expect(configuration).toEqual({ scoringKind: 'model', configurationDigest: model.configurationDigest, scorerVersion: model.scorerVersion })
  expect(learnReportScorerConfigurationSchema.parse(configuration)).toEqual(configuration)
  expect(await deriveLearnScorerConfiguration({ ...model, requestedModel: 'another-model' })).toEqual(configuration)
})

test('hashes the complete deterministic binding as canonical JSON, independent of property order', async () => {
  const reversed = { transitionVersion: deterministic.transitionVersion, thresholdPercent: deterministic.thresholdPercent,
    thresholdVersion: deterministic.thresholdVersion, engineVersion: deterministic.engineVersion, kind: deterministic.kind }
  const original = JSON.stringify(reversed)
  const configuration = await deriveLearnScorerConfiguration(Object.freeze(deterministic))
  // SHA-256 of the full binding with lexically sorted object keys and no whitespace.
  expect(configuration).toEqual({ scoringKind: 'deterministic', scorerVersion: 'keyed-scorer.v1',
    configurationDigest: 'sha256:6429a8b4673eff4d93a8524e94c525ebd2d65bf39e9aa7f71f8e41fdc6cdc114' })
  expect(await deriveLearnScorerConfiguration(reversed)).toEqual(configuration)
  expect(await deriveLearnScorerConfiguration(deterministic)).toEqual(configuration)
  expect(JSON.stringify(reversed)).toBe(original)
  expect(learnReportScorerConfigurationSchema.parse(configuration)).toEqual(configuration)
})

test.each(['engineVersion', 'thresholdVersion'] as const)('includes %s in the deterministic digest', async field => {
  const original = await deriveLearnScorerConfiguration(deterministic)
  const changed = await deriveLearnScorerConfiguration({ ...deterministic, [field]: 'changed.v2' })
  expect(changed.configurationDigest).not.toBe(original.configurationDigest)
  expect(changed.scorerVersion).toBe(field === 'engineVersion' ? 'changed.v2' : deterministic.engineVersion)
})

test('rejects undeclared or invalid bindings rather than hashing an unvalidated projection', async () => {
  await expect(deriveLearnScorerConfiguration({ ...deterministic, thresholdPercent: 75 } as never)).rejects.toThrow()
  await expect(deriveLearnScorerConfiguration({ ...deterministic, undeclared: 'private text' } as never)).rejects.toThrow()
})
