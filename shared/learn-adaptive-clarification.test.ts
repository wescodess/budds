import { describe, expect, test } from 'vitest'
import { INITIAL_DECISION_VERSION, digestInitialDecisionInput, renderClarification, selectInitialDecision, validateClarificationAnswer } from './learn-adaptive-clarification'

const base = {
  intent: 'understand' as const,
  availableTime: '15' as const,
  authorityKind: 'standalone' as const,
  sourceKind: 'none' as const,
  evidenceState: 'none' as const,
  outcomeProvenance: 'need_fallback' as const,
  threadRevision: 1,
}

describe('Phase-1 initial clarification policy', () => {
  test('asks one useful-outcome question only for an unresolved prepare/build outcome', () => {
    expect(selectInitialDecision({ ...base, intent: 'prepare' })).toEqual({
      decisionVersion: INITIAL_DECISION_VERSION,
      kind: 'clarification',
      questionKey: 'useful_outcome',
      reasonCode: 'outcome_needed_for_first_move',
      continuationKind: 'standalone_non_factual',
    })
    expect(selectInitialDecision({ ...base, intent: 'build', evidenceState: 'preparing', sourceKind: 'document' })).toMatchObject({ kind: 'clarification', continuationKind: 'preparing_non_factual' })
    expect(selectInitialDecision({ ...base, intent: 'prepare', outcomeProvenance: 'explicit' })).toMatchObject({ kind: 'direct', continuationKind: 'standalone_non_factual' })
  })

  test.each(['understand', 'master', 'refresh', 'explore'] as const)('continues directly for declared %s intent', intent => {
    expect(selectInitialDecision({ ...base, intent })).toMatchObject({ kind: 'direct', reasonCode: 'declared_inputs_sufficient', continuationKind: 'standalone_non_factual' })
  })

  test.each(['blocked', 'stale', 'invalidated', 'unavailable'] as const)('routes %s evidence to recovery without clarification', evidenceState => {
    expect(selectInitialDecision({ ...base, intent: 'build', evidenceState })).toMatchObject({ kind: 'direct', reasonCode: 'evidence_requires_recovery', continuationKind: 'evidence_recovery' })
  })

  test('selects only closed continuation seams from authority and evidence state', () => {
    expect(selectInitialDecision({ ...base, evidenceState: 'preparing', sourceKind: 'folder' })).toMatchObject({ continuationKind: 'preparing_non_factual' })
    expect(selectInitialDecision({ ...base, authorityKind: 'v2_mission', evidenceState: 'ready' })).toMatchObject({ continuationKind: 'ready_v2' })
  })

  test.each(['none', 'folder', 'document', 'url', 'pasted'] as const)('keeps the %s source scope structural', sourceKind => {
    expect(selectInitialDecision({ ...base, sourceKind })).toMatchObject({ kind: 'direct', continuationKind: 'standalone_non_factual' })
  })

  test('digests canonical bounded structural inputs without learner wording or private locators', async () => {
    const reordered = { threadRevision: 1, outcomeProvenance: 'need_fallback' as const, evidenceState: 'none' as const, sourceKind: 'none' as const, authorityKind: 'standalone' as const, availableTime: '15' as const, intent: 'understand' as const }
    await expect(digestInitialDecisionInput(base)).resolves.toMatch(/^sha256:[a-f0-9]{64}$/)
    await expect(digestInitialDecisionInput(reordered)).resolves.toBe(await digestInitialDecisionInput(base))
    expect(JSON.stringify(base)).not.toContain('learner')
    expect(JSON.stringify(base)).not.toContain('sourceId')
  })

  test('renders only the closed server template and bounds learner answers by UTF-8 bytes', () => {
    expect(renderClarification('useful_outcome')).toEqual({
      templateVersion: 'learn-adaptive.clarification-templates.v1',
      prompt: 'What outcome would make this first step useful?',
      help: 'Name one concrete result. You can also skip and continue from your original wording.',
    })
    expect(() => renderClarification('useful_outcome', 'learn-adaptive.clarification-templates.v2')).toThrow(/template version/i)
    expect(validateClarificationAnswer('  A useful result.  ')).toBe('A useful result.')
    expect(() => validateClarificationAnswer('   ')).toThrow(/between 1 and 1000 bytes/i)
    expect(() => validateClarificationAnswer('💥'.repeat(251))).toThrow(/between 1 and 1000 bytes/i)
  })
})
