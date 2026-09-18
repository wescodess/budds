import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { parseLearnV2PlanResult } from '~/utils/learn-v2-plan-result'

const path = ['~', 'components', 'learn-v2'].join('/')

const mission = {
  id: 'mission_async',
  title: 'Apply async patterns with confidence',
  folderName: 'Frontend foundations',
  lifecycle: 'active' as const,
  nextAction: { kind: 'start_session' as const, label: 'Start 25-minute session', detail: 'Practice cancellation and error boundaries.' },
  mastery: { retained: 1, independent: 2, learning: 2, total: 7 },
}

describe('Learn V2 journey workspace seams', () => {
  it('degrades malformed legacy plan snapshots instead of taking down the workspace', () => {
    expect(parseLearnV2PlanResult('{not-json')).toEqual({})
    expect(parseLearnV2PlanResult(JSON.stringify({ status: 'feasible', reasonCodes: ['deadline'], alternatives: [{ code: 'extend_target' }, { code: 2 }] }))).toEqual({ status: 'feasible', reasonCodes: ['deadline'], alternatives: [{ code: 'extend_target' }] })
  })

  it('makes the next learning action decisive and emits its intent', async () => {
    const Comp = await import(`${path}/LearnHub.vue`)
    const wrapper = await mountSuspended(Comp.default, { props: { snapshot: { today: mission, missions: [mission] } } })

    expect(wrapper.get('[data-testid="learn-v2-hub-next-action"]').text()).toContain('Start 25-minute session')
    await wrapper.get('[data-testid="learn-v2-hub-next-action"]').trigger('click')
    expect(wrapper.emitted('startSession')?.[0]).toEqual(['mission_async'])
  })

  it('keeps outcome setup controlled by the caller and emits a source-review intention', async () => {
    const Comp = await import(`${path}/OutcomeCanvas.vue`)
    const wrapper = await mountSuspended(Comp.default, {
      props: { draft: { folderName: 'Frontend foundations', folderDocumentCount: 3, outcome: '', mode: 'understand', depth: 'working', sessionMinutes: 25, sourcePolicy: 'folder_plus_web' } },
    })

    const continueButton = wrapper.get('[data-testid="learn-v2-outcome-continue"]')
    expect((continueButton.element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('[data-testid="learn-v2-outcome-input"]').setValue('Explain cancellation to a teammate')
    await continueButton.trigger('click')
    expect(wrapper.emitted('continueToSources')?.[0]?.[0]).toMatchObject({ outcome: 'Explain cancellation to a teammate', sourcePolicy: 'folder_plus_web' })
  })

  it('keeps target date and session length in the saved outcome intent', async () => {
    const Comp = await import(`${path}/OutcomeCanvas.vue`)
    const wrapper = await mountSuspended(Comp.default, {
      props: { draft: { folderName: 'Frontend foundations', folderDocumentCount: 3, outcome: 'Explain cancellation to a teammate', mode: 'understand', depth: 'working', sessionMinutes: 25, sourcePolicy: 'folder_plus_web' } },
    })
    const selects = wrapper.findAll('select')
    await selects[2]!.setValue('45')
    await wrapper.find('input[type="date"]').setValue('2031-05-20')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('saveDraft')?.[0]).toEqual([expect.objectContaining({ targetDate: '2031-05-20', sessionMinutes: 45 })])
  })

  it('keeps source acceptance explicit and distinguishes evidence origin', async () => {
    const Comp = await import(`${path}/EvidenceDesk.vue`)
    const source = { id: 'source_1', sourceKey: 'identity_1', title: 'AbortController', origin: 'folder_document' as const, publisher: 'MDN', retrievedLabel: 'Reviewed from your folder', coverage: 'strong' as const, lifecycle: 'evaluated' as const, objectives: ['Cancel a request safely'] }
    const wrapper = await mountSuspended(Comp.default, { props: { sources: [source], selectedSourceId: 'source_1' } })

    expect(wrapper.text()).toContain('Your folder')
    expect(wrapper.get('[data-testid="learn-v2-source-inspector"]').text()).toContain('MDN')
    await wrapper.get('[data-testid="learn-v2-source-accept-source_1"]').trigger('click')
    expect(wrapper.emitted('acceptSource')?.[0]).toEqual(['source_1'])
  })

  it('turns a learner research query into an explicit, reviewable discovery action', async () => {
    const Comp = await import(`${path}/EvidenceDesk.vue`)
    const wrapper = await mountSuspended(Comp.default, {
      props: { sources: [], researchResults: [{ title: 'MDN AbortController', url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController', snippet: 'Cancellation API reference.' }] },
    })

    await wrapper.get('[data-testid="learn-v2-research-query"]').setValue('AbortController cancellation')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('research')?.[0]).toEqual(['AbortController cancellation'])
    await wrapper.get('[aria-label="Research results"] button').trigger('click')
    expect(wrapper.emitted('addUrl')?.[0]).toEqual(['https://developer.mozilla.org/en-US/docs/Web/API/AbortController', 'MDN AbortController'])
  })

  it('disables every web-source intake control for a folder-only plan', async () => {
    const Comp = await import(`${path}/EvidenceDesk.vue`)
    const wrapper = await mountSuspended(Comp.default, { props: { sources: [], canResearch: false } })

    expect(wrapper.get('[data-testid="learn-v2-research-query"]').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('[data-testid="learn-v2-source-url"]').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('[data-testid="learn-v2-source-add-url"]').attributes()).toHaveProperty('disabled')
  })

  it('renders permitted evidence and a safe original-source link in the inspector', async () => {
    const Comp = await import(`${path}/EvidenceDesk.vue`)
    const wrapper = await mountSuspended(Comp.default, {
      props: { sources: [{ id: 'source_1', title: 'AbortController', origin: 'user_url' as const, retrievedLabel: 'Retrieved today', coverage: 'partial' as const, lifecycle: 'evaluated' as const, objectives: [], excerpt: 'AbortController lets you cancel requests.', originalUrl: 'https://developer.mozilla.org/' }], selectedSourceId: 'source_1' },
    })

    expect(wrapper.get('[data-testid="learn-v2-source-inspector"]').text()).toContain('cancel requests')
    const original = wrapper.get('a[href="https://developer.mozilla.org/"]')
    expect(original.attributes('target')).toBe('_blank')
    expect(original.attributes('rel')).toContain('noopener')
  })

  it('makes unavailable evidence replaceable instead of leaving it preparing forever', async () => {
    const Comp = await import(`${path}/EvidenceDesk.vue`)
    const wrapper = await mountSuspended(Comp.default, {
      props: {
        sources: [{ id: 'source_failed', title: 'Unavailable reference', origin: 'user_url' as const, retrievedLabel: 'Could not retrieve', coverage: 'gap' as const, lifecycle: 'unavailable' as const, objectives: [], originalUrl: 'https://example.org/', accessNote: 'The source could not be retrieved.' }],
        selectedSourceId: 'source_failed',
      },
    })

    const inspector = wrapper.get('[data-testid="learn-v2-source-inspector"]')
    expect(inspector.text()).toContain('Evidence is unavailable')
    expect(inspector.text()).not.toContain('Preparing evidence')
    await wrapper.get('[data-testid="learn-v2-source-replace-source_failed"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-source-url"]').attributes('aria-describedby')).toBe('learn-v2-source-replacement-help')
    await wrapper.get('[data-testid="learn-v2-source-url"]').setValue('https://example.org/replacement')
    await wrapper.findAll('form')[1]!.trigger('submit')
    expect(wrapper.emitted('addUrl')?.[0]).toEqual(['https://example.org/replacement'])
    expect(wrapper.get('[data-testid="learn-v2-source-url"]').attributes('aria-describedby')).toBeUndefined()
  })

  it('lets the learner prepare a candidate after a transient evidence check failure', async () => {
    const Comp = await import(`${path}/EvidenceDesk.vue`)
    const wrapper = await mountSuspended(Comp.default, {
      props: { sources: [{ id: 'source_pending', title: 'Reference', origin: 'user_url' as const, retrievedLabel: 'candidate', coverage: 'partial' as const, lifecycle: 'candidate' as const, objectives: [] }] },
    })

    expect(wrapper.text()).not.toContain('Preparing evidence')
    await wrapper.get('[data-testid="learn-v2-source-prepare-source_pending"]').trigger('click')
    expect(wrapper.emitted('prepareSource')?.[0]).toEqual(['source_pending'])
  })

  it('opens the source the learner selects when the workspace does not control selection', async () => {
    const Comp = await import(`${path}/EvidenceDesk.vue`)
    const wrapper = await mountSuspended(Comp.default, {
      props: { sources: [
        { id: 'source_failed', title: 'Unavailable reference', origin: 'user_url' as const, retrievedLabel: 'unavailable', coverage: 'gap' as const, lifecycle: 'unavailable' as const, objectives: [] },
        { id: 'source_ready', title: 'Ready reference', origin: 'folder_document' as const, retrievedLabel: 'evaluated', coverage: 'partial' as const, lifecycle: 'evaluated' as const, objectives: [] },
      ] },
    })

    expect(wrapper.get('[data-testid="learn-v2-source-inspector"]').text()).toContain('Unavailable reference')
    await wrapper.get('[data-testid="learn-v2-source-row-source_ready"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-source-inspector"]').text()).toContain('Ready reference')
    expect(wrapper.find('[data-testid="learn-v2-source-accept-source_ready"]').exists()).toBe(true)
  })

  it('offers every workspace area and reports the blocked next action', async () => {
    const Comp = await import(`${path}/MissionWorkspaceShell.vue`)
    const wrapper = await mountSuspended(Comp.default, {
      props: { mission: { ...mission, lifecycle: 'map_review', nextAction: { kind: 'review_sources', label: 'Resolve one evidence gap', detail: 'The error-handling objective needs a source.' } }, activeSection: 'map', readiness: [{ id: 'outcome', label: 'Outcome', state: 'complete' }, { id: 'sources', label: 'Sources', state: 'attention', detail: 'One gap needs attention' }] },
    })

    expect(wrapper.get('[data-testid="learn-v2-workspace-next-action"]').text()).toContain('Resolve one evidence gap')
    expect(wrapper.get('[data-testid="learn-v2-workspace-nav-map"]').attributes('aria-current')).toBe('page')
    await wrapper.get('[data-testid="learn-v2-workspace-nav-sources"]').trigger('click')
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['sources'])
  })

  it('keeps map edits explicit and emits a complete learner change', async () => {
    const Comp = await import(`${path}/LearningTrail.vue`)
    const assessmentContract = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const, instructions: 'Explain from evidence.', passingScorePercent: 80 as const, criteria: [{ key: 'correct', description: 'Correct and supported.', weightPercent: 100 }] }
    const wrapper = await mountSuspended(Comp.default, {
      props: { objectives: [{ id: 'objective_1', stableKey: 'objective-1', title: 'Understand cancellation', capability: 'Explain cancellation boundaries', milestoneKey: 'milestone-1', milestone: 'Foundation', effortMinutes: 25, depth: 'working', mastery: 'unseen', coverage: 'strong', prerequisiteIds: [], prerequisiteKeys: [], assessment: assessmentContract.instructions, assessmentContract, sourceLinks: [{ sourceKey: 'identity-1', title: 'AbortController', origin: 'folder_document', coverage: 'strong', evidenceStatus: 'evidence_available' }] }], sources: [{ id: 'source-1', sourceKey: 'identity-1', title: 'AbortController', origin: 'folder_document', retrievedLabel: 'Accepted', coverage: 'strong', lifecycle: 'user_accepted', objectives: [] }] },
    })

    await wrapper.get('[data-testid="learn-v2-map-edit-objective"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Explain cancellation safely')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    expect(wrapper.emitted('editMap')?.[0]?.[0]).toMatchObject({ kind: 'save_objective', objective: { objectiveKey: 'objective-1', title: 'Explain cancellation safely', depth: 'working', supportingSourceKeys: ['identity-1'], assessmentContract: { passingScorePercent: 80 } } })
  })

  it('offers revision-safe reorder, split, and confirmed removal controls', async () => {
    const Comp = await import(`${path}/LearningTrail.vue`)
    const assessmentContract = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const, instructions: 'Explain from evidence.', passingScorePercent: 80 as const, criteria: [{ key: 'correct', description: 'Correct and supported.', weightPercent: 100 }] }
    const objectives = Array.from({ length: 7 }, (_, index) => ({ id: `objective_${index + 1}`, stableKey: `objective-${index + 1}`, title: `Objective ${index + 1}`, capability: `Capability ${index + 1}`, milestoneKey: `milestone-${Math.min(3, Math.floor(index / 2) + 1)}`, milestone: `Milestone ${Math.min(3, Math.floor(index / 2) + 1)}`, effortMinutes: 25, depth: 'working' as const, mastery: 'unseen' as const, coverage: 'strong' as const, prerequisiteIds: [], prerequisiteKeys: index ? [`objective-${index}`] : [], assessment: assessmentContract.instructions, assessmentContract, sourceLinks: [{ sourceKey: 'identity-1', title: 'Accepted evidence', origin: 'folder_document' as const, coverage: 'strong' as const, evidenceStatus: 'evidence_available' as const }] }))
    const wrapper = await mountSuspended(Comp.default, { props: { objectives } })

    await wrapper.get('[data-testid="learn-v2-map-move-down-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-map-split-objective"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-split-second-title"]').setValue('Apply objective 1')
    await wrapper.get('[data-testid="learn-v2-save-split"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-map-remove-objective"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-confirm-remove-objective"]').trigger('click')

    expect(wrapper.emitted('editMap')?.map(event => event[0])).toEqual([
      { kind: 'move_objective', objectiveKey: 'objective-1', direction: 'down' },
      { kind: 'split_objective', objectiveKey: 'objective-1', firstTitle: 'Objective 1', secondTitle: 'Apply objective 1' },
      { kind: 'remove_objective', objectiveKey: 'objective-1' },
    ])
  })

  it('makes feasibility-aware plan inputs editable before preview generation', async () => {
    const Comp = await import(`${path}/StudyPlanEditor.vue`)
    const wrapper = await mountSuspended(Comp.default, {
      props: { input: { version: 'learn-v2.schedule-input.v1', timezone: 'America/Toronto', startLocalDate: '2030-09-01', targetLocalDate: '2030-10-01', sessionMinutes: 25, availability: [{ weekday: 1, start: '18:00', end: '20:00' }], blackoutDates: [], reviewIntervalsDays: [1, 3], minRestMinutes: 720 } },
    })
    await wrapper.get('[data-testid="learn-v2-schedule-minutes"]').setValue('45')
    await wrapper.get('[data-testid="learn-v2-create-plan-preview"]').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({ timezone: 'America/Toronto', sessionMinutes: 45, availability: [{ weekday: 1, start: '18:00', end: '20:00' }] })
  })
})
