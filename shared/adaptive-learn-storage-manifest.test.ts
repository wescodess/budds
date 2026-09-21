import { describe, expect, test } from 'vitest'
import {
  ADAPTIVE_LEARN_ACCOUNT_DELETE_ORDER,
  ADAPTIVE_LEARN_EXPORT_COLLECTIONS,
  ADAPTIVE_LEARN_STORAGE_MANIFEST,
  ADAPTIVE_ACTIVITY_STORAGE_REGISTRY,
  adaptiveActivityPrimitiveInputValidator,
  adaptiveActivityPrimitivePlanValidator,
} from './adaptive-learn-storage-manifest'
import { getAdaptiveActivityRegistry } from './learn-adaptive-activity-registry'

describe('Adaptive Learn storage manifest', () => {
  test('registers activity children before thread parents with bounded owner-scoped retention', () => {
    expect(ADAPTIVE_LEARN_STORAGE_MANIFEST).toEqual([
      {
        table: 'learnActivityCommandReceipts',
        ownerIndex: 'by_userId',
        parentIndex: 'by_userId_and_threadId',
        export: 'redacted_bounded',
        accountDeletion: 'delete',
      },
      {
        table: 'learningThreadActivities',
        ownerIndex: 'by_userId',
        parentIndex: 'by_userId_and_threadId_and_boundaryOrdinal',
        export: 'redacted_bounded',
        accountDeletion: 'delete',
      },
      {
        table: 'learningThreads',
        ownerIndex: 'by_userId',
        parentIndex: 'by_userId_and_updatedAt',
        export: 'bounded',
        accountDeletion: 'delete',
      },
    ])
    expect(ADAPTIVE_LEARN_ACCOUNT_DELETE_ORDER).toEqual(['learnActivityCommandReceipts', 'learningThreadActivities', 'learningThreads'])
    expect(ADAPTIVE_LEARN_EXPORT_COLLECTIONS).toEqual(['learningThreads', 'learningThreadActivities', 'learnActivityCommandReceipts'])
  })

  test('keeps stored primitive discriminants and actions aligned with the runtime registry', () => {
    expect(ADAPTIVE_ACTIVITY_STORAGE_REGISTRY.map(({ inputProps: _inputProps, storedProps: _storedProps, ...entry }) => entry)).toEqual(getAdaptiveActivityRegistry().primitives)

    type Json = { type: string, value?: unknown }
    const variants = (json: Json) => (json.value as Json[]).map(member => member.value as Record<string, { fieldType: Json }>)
    const literals = (json: Json): string[] => json.type === 'literal'
      ? [String(json.value)]
      : (json.value as Json[]).flatMap(literals)
    const summarize = (members: Array<Record<string, { fieldType: Json }>>) => members.map(fields => ({
      type: literals(fields.type!.fieldType)[0],
      allowedActions: literals(fields.action!.fieldType),
      testId: fields.testId ? literals(fields.testId.fieldType)[0] : undefined,
      props: Object.keys((fields.props!.fieldType.value as Record<string, unknown>)).sort(),
    }))
    const inputJson = (adaptiveActivityPrimitiveInputValidator as unknown as { json: Json }).json
    const storedArrayJson = (adaptiveActivityPrimitivePlanValidator as unknown as { json: Json }).json
    const storedUnionJson = storedArrayJson.value as Json
    expect(summarize(variants(inputJson))).toEqual(ADAPTIVE_ACTIVITY_STORAGE_REGISTRY.map(entry => ({
      type: entry.type,
      allowedActions: [...entry.allowedActions],
      testId: undefined,
      props: [...entry.inputProps].sort(),
    })))
    expect(summarize(variants(storedUnionJson))).toEqual(ADAPTIVE_ACTIVITY_STORAGE_REGISTRY.map(entry => ({
      type: entry.type,
      allowedActions: [...entry.allowedActions],
      testId: entry.testId,
      props: [...entry.storedProps].sort(),
    })))
  })
})
