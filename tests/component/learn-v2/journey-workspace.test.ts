import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

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

  it('keeps source acceptance explicit and distinguishes evidence origin', async () => {
    const Comp = await import(`${path}/EvidenceDesk.vue`)
    const source = { id: 'source_1', title: 'AbortController', origin: 'folder_document' as const, publisher: 'MDN', retrievedLabel: 'Added from your folder', coverage: 'strong' as const, lifecycle: 'fetched' as const, objectives: ['Cancel a request safely'] }
    const wrapper = await mountSuspended(Comp.default, { props: { sources: [source], selectedSourceId: 'source_1' } })

    expect(wrapper.text()).toContain('Your folder')
    expect(wrapper.get('[data-testid="learn-v2-source-inspector"]').text()).toContain('MDN')
    await wrapper.get('[data-testid="learn-v2-source-accept-source_1"]').trigger('click')
    expect(wrapper.emitted('acceptSource')?.[0]).toEqual(['source_1'])
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
})
