import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { LearnMapEdit, LearnMapSaveResult, LearnObjectiveSnapshot, LearnSourceSnapshot } from '~/types/learn-v2-journey'

const path = ['~', 'components', 'learn-v2'].join('/')
const milestoneOf = (index: number) => index < 2 ? 1 : index < 4 ? 2 : 3

function objective(index: number, overrides: Partial<LearnObjectiveSnapshot> = {}): LearnObjectiveSnapshot {
  const milestone = milestoneOf(index)
  return {
    id: `objective_${index + 1}`, stableKey: `objective-${index + 1}`, title: `Objective ${index + 1}`, capability: `Capability ${index + 1}`,
    milestoneKey: `milestone-${milestone}`, milestone: `Milestone ${milestone}`, effortMinutes: 25, depth: 'working', mastery: 'unseen', coverage: 'strong',
    prerequisiteIds: [], prerequisiteKeys: index ? [`objective-${index}`] : [],
    sourceLinks: [{ sourceKey: 'identity-1', title: 'AbortController guide', origin: 'folder_document', coverage: 'strong', evidenceStatus: 'evidence_available' }],
    ...overrides,
  }
}

const sources: LearnSourceSnapshot[] = [
  { id: 'source-1', sourceKey: 'identity-1', title: 'AbortController guide', origin: 'folder_document', retrievedLabel: 'Accepted', coverage: 'strong', lifecycle: 'user_accepted', objectives: [] },
  { id: 'source-2', sourceKey: 'identity-2', title: 'Fetch specification', origin: 'user_url', publisher: 'fetch.spec.whatwg.org', retrievedLabel: 'Accepted', coverage: 'strong', lifecycle: 'user_accepted', objectives: [] },
]

async function mountTrail(options: { objectives?: LearnObjectiveSnapshot[]; save?: (edit: LearnMapEdit) => Promise<LearnMapSaveResult>; canAccept?: boolean; loading?: boolean } = {}) {
  const Comp = await import(`${path}/LearningTrail.vue`)
  const save = vi.fn(options.save ?? (async () => ({ ok: true }) as LearnMapSaveResult))
  const wrapper = await mountSuspended(Comp.default, {
    props: { objectives: options.objectives ?? Array.from({ length: 7 }, (_, index) => objective(index)), sources, canAccept: options.canAccept ?? true, loading: options.loading ?? false, save },
    attachTo: document.body,
  })
  return { wrapper, save }
}

describe('Learner map editor', () => {
  it('reads as an outline grouped by milestone with numbered citations and the sources list', async () => {
    const { wrapper } = await mountTrail({ objectives: [objective(0), objective(1), objective(2, { coverage: 'partial', gapReason: 'Your sources skip timeouts.' }), objective(3), objective(4), objective(5)] })

    expect(wrapper.findAll('h3').map(heading => heading.text())).toEqual(['Milestone 1', 'Milestone 2', 'Milestone 3', 'Sources'])
    expect(wrapper.text()).toContain('Working fluency · 25 min · After 2')
    expect(wrapper.text()).toContain('Your sources skip timeouts.')
    expect(wrapper.findAll('a[aria-label="Source 1"]')).toHaveLength(6)
    expect(wrapper.text()).toContain('Your folder · backs 1, 2, 3, 4, 5, 6')
    expect(wrapper.text()).toContain('Added by you · fetch.spec.whatwg.org')
    await wrapper.get('[data-testid="learn-v2-map-manage-sources"]').trigger('click')
    expect(wrapper.emitted('manageSources')).toHaveLength(1)
    wrapper.unmount()
  })

  it('edits the words in place and saves one change without any assessment fields', async () => {
    const { wrapper, save } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-2"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Changes to this objective are saved together.')
    expect(wrapper.get('[data-testid="learn-v2-save-objective"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Explain cancellation safely')

    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Not saved yet: wording.')
    expect(wrapper.get('[data-testid="learn-v2-map-pending"]').text()).toContain('Objective 2 isn’t saved yet.')
    expect(wrapper.get('[data-testid="learn-v2-accept-map"]').attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    const edit = save.mock.calls[0]![0]
    expect(edit).toMatchObject({ kind: 'save_objective', objective: { objectiveKey: 'objective-2', title: 'Explain cancellation safely', supportingSourceKeys: ['identity-1'] }, order: ['objective-1', 'objective-2', 'objective-3', 'objective-4', 'objective-5', 'objective-6', 'objective-7'] })
    expect(JSON.stringify(edit)).not.toMatch(/assessment|criteri|rubric|weight/i)
    wrapper.unmount()
  })

  it('holds a move across a milestone until save', async () => {
    const { wrapper, save } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-3"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-map-move-up-objective-3"]').trigger('click')
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Not saved yet: order.')
    expect(wrapper.findAll('section')[0]!.find('[data-testid="learn-v2-objective-editor"]').exists()).toBe(true)

    await wrapper.get('[data-testid="learn-v2-map-move-up-objective-3"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    expect(save.mock.calls[0]![0]).toMatchObject({ kind: 'save_objective', objective: { objectiveKey: 'objective-3', milestoneKey: 'milestone-1' }, order: ['objective-1', 'objective-3', 'objective-2', 'objective-4', 'objective-5', 'objective-6', 'objective-7'] })
    wrapper.unmount()
  })

  it('holds a split with the other changes and sends them in one save', async () => {
    const { wrapper, save } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Recognise cancellation')
    await wrapper.get('[data-testid="learn-v2-map-split-objective"]').trigger('click')
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="learn-v2-map-split-objective"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="learn-v2-map-remove-objective"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Not saved yet: wording and split.')

    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0]).toMatchObject({ kind: 'save_objective', objective: { objectiveKey: 'objective-1', title: 'Recognise cancellation' }, split: { secondTitle: 'Recognise cancellation: apply' } })
    wrapper.unmount()
  })

  it('discards a held split on Cancel', async () => {
    const { wrapper, save } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-map-split-objective"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-close"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-map-split-objective"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Changes to this objective are saved together.')
    expect(save).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('holds a removal until save', async () => {
    const { wrapper, save } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-map-remove-objective"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-map-remove-objective"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="learn-v2-map-split-objective"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Not saved yet: removal.')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    expect(save.mock.calls[0]![0]).toEqual({ kind: 'remove_objective', objectiveKey: 'objective-1' })
    expect(wrapper.find('[data-testid="learn-v2-objective-editor"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('locks the objective while saving', async () => {
    let finish: (result: LearnMapSaveResult) => void = () => {}
    const { wrapper } = await mountTrail({ save: () => new Promise(resolve => { finish = resolve }) })

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Explain cancellation')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')

    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Saving your changes…')
    expect(wrapper.get('[data-testid="learn-v2-save-objective"]').text()).toBe('Saving')
    expect(wrapper.get('[data-testid="learn-v2-objective-title"]').attributes('readonly')).toBeDefined()
    expect(wrapper.get('[data-testid="learn-v2-objective-editor"]').attributes('aria-busy')).toBe('true')
    const sourcesChip = wrapper.get('[data-testid="learn-v2-objective-sources"]')
    expect(sourcesChip.attributes('aria-disabled')).toBe('true')
    await sourcesChip.trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    finish({ ok: true })
    wrapper.unmount()
  })

  it('keeps the changes and says so when a save fails', async () => {
    const { wrapper } = await mountTrail({ save: async () => ({ ok: false, reason: 'failed' }) })

    await wrapper.get('[data-testid="learn-v2-map-select-objective-2"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Explain cancellation')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[role="alert"]').text()).toBe('Couldn’t save objective 2. Your changes are still here. Try again.')
    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Not saved. Your changes are still here.')
    expect((wrapper.get('[data-testid="learn-v2-objective-title"]').element as HTMLTextAreaElement).value).toBe('Explain cancellation')
    expect(wrapper.find('[data-testid="learn-v2-map-reload"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers one way on when the map changed somewhere else', async () => {
    const { wrapper } = await mountTrail({ save: async () => ({ ok: false, reason: 'changed' }) })

    await wrapper.get('[data-testid="learn-v2-map-select-objective-2"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Explain cancellation')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[role="alert"]').text()).toContain('The map changed somewhere else, so objective 2 wasn’t saved. Your changes are still here.')
    await wrapper.get('[data-testid="learn-v2-map-reload"]').trigger('click')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Not saved yet: wording.')
    expect((wrapper.get('[data-testid="learn-v2-objective-title"]').element as HTMLTextAreaElement).value).toBe('Explain cancellation')
    wrapper.unmount()
  })

  it('changes time, depth, what comes first and sources through their pop-overs', async () => {
    const { wrapper, save } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-3"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-sources"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').attributes('aria-labelledby')).toBeDefined()
    expect(wrapper.get('[role="dialog"]').text()).toContain('Sources for objective 3')
    await wrapper.get('input[type="radio"][value="partial"]').setValue(true)
    await wrapper.get('[data-testid="learn-v2-objective-gap-reason"]').setValue('No source covers retries.')
    await wrapper.get('input[type="checkbox"][value="identity-2"]').setValue(true)
    expect(wrapper.get('[role="dialog"]').text()).not.toContain('Looked at, but not enough')

    await wrapper.findAll('[aria-expanded]').find(chip => chip.text().includes('change what to learn first'))!.trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Learn first, before objective 3')
    expect(wrapper.get('input[type="checkbox"][value="objective-4"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="dialog"]').text()).toContain('Comes after this one')
    await wrapper.get('input[type="checkbox"][value="objective-1"]').setValue(true)

    await wrapper.findAll('[aria-expanded]').find(chip => chip.text().includes('change depth'))!.trigger('click')
    await wrapper.get('input[type="radio"][value="advanced"]').setValue(true)
    await wrapper.findAll('[aria-expanded]').find(chip => chip.text().includes('change time'))!.trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-effort"]').setValue('40')

    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Not saved yet: time, depth, what comes first and sources.')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    expect(save.mock.calls[0]![0]).toMatchObject({ kind: 'save_objective', objective: { effortMinutes: 40, depth: 'advanced', coverage: 'partial', gapReason: 'No source covers retries.', supportingSourceKeys: ['identity-1', 'identity-2'], prerequisiteKeys: ['objective-2', 'objective-1'] } })
    wrapper.unmount()
  })

  it('closes a pop-over with Escape and returns focus to its chip', async () => {
    const { wrapper } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-sources"]').trigger('click')
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="learn-v2-objective-sources"]').element)
    wrapper.unmount()
  })

  it('lists the order by milestone with the current objective marked and gaps flagged', async () => {
    const objectives = Array.from({ length: 7 }, (_, index) => objective(index, index === 4 ? { coverage: 'gap', gapReason: 'Nothing covers this.', sourceLinks: [] } : {}))
    const { wrapper } = await mountTrail({ objectives })

    expect(wrapper.get('[data-testid="learn-v2-map-order"]').text()).toContain('7 objectives · about 2 hr 55 min')
    await wrapper.get('[data-testid="learn-v2-map-select-objective-3"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-map-order"]').trigger('click')
    const order = wrapper.get('[role="dialog"][aria-label="Order of objectives"]')
    expect(order.text()).toContain('Order · 7 objectives')
    expect(order.get('[aria-current="true"]').text()).toContain('Objective 3')
    expect(order.text()).toContain('Not covered yet')
    await order.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[aria-label="Order of objectives"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('adds a new objective to the end of the map', async () => {
    const { wrapper, save } = await mountTrail()

    expect(wrapper.find('[data-testid="learn-v2-map-full"]').exists()).toBe(false)
    await wrapper.get('[data-testid="learn-v2-map-add-objective"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-objective-editor"]').text()).toContain('8')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Compare abort signals')
    await wrapper.get('[data-testid="learn-v2-objective-capability"]').setValue('Choose between abort signals.')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    const edit = save.mock.calls[0]![0]
    expect(edit).toMatchObject({ kind: 'save_objective', objective: { title: 'Compare abort signals', milestoneKey: 'milestone-3', prerequisiteKeys: ['objective-7'] } })
    expect(edit).not.toHaveProperty('order')
    expect(edit.kind === 'save_objective' && edit.objective.objectiveKey).toBeFalsy()
    wrapper.unmount()
  })

  it('stops adding and splitting at fifteen objectives', async () => {
    const { wrapper } = await mountTrail({ objectives: Array.from({ length: 15 }, (_, index) => objective(index)) })

    const add = wrapper.get('[data-testid="learn-v2-map-add-objective"]')
    expect(add.attributes('disabled')).toBeDefined()
    const reason = wrapper.get('[data-testid="learn-v2-map-full"]')
    expect(reason.text()).toBe('A map holds up to 15 objectives. Remove one to add another.')
    expect(add.attributes('aria-describedby')).toBe(reason.attributes('id'))
    expect(wrapper.get('[data-testid="learn-v2-map-order"]').text()).toContain('15 objectives · about 6 hr 15 min')
    await wrapper.get('[data-testid="learn-v2-map-select-objective-15"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-map-split-objective"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="learn-v2-map-move-down-objective-15"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('explains an empty map without offering Accept', async () => {
    const { wrapper } = await mountTrail({ objectives: [] })

    const empty = wrapper.get('[data-testid="learn-v2-map-empty"]')
    expect(empty.text()).toContain('No objectives yet')
    expect(empty.text()).toContain('Go to Sources to generate it.')
    expect(empty.text()).not.toMatch(/\badd\b/i)
    expect(wrapper.find('[data-testid="learn-v2-accept-map"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learn-v2-map-add-objective"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the map loading without actions', async () => {
    const { wrapper } = await mountTrail({ objectives: [], loading: true })

    expect(wrapper.get('[data-testid="learn-v2-map-loading"]').attributes('role')).toBe('status')
    expect(wrapper.text()).toContain('Loading your learning map…')
    expect(wrapper.find('[data-testid="learn-v2-map-empty"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learn-v2-map-add-objective"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learn-v2-accept-map"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('holds up with a single objective', async () => {
    const { wrapper } = await mountTrail({ objectives: [objective(0)] })

    expect(wrapper.text()).toContain('Working fluency · 25 min · Start here')
    expect(wrapper.get('[data-testid="learn-v2-map-order"]').text()).toContain('1 objective · about 25 min')
    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-map-move-up-objective-1"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="learn-v2-map-move-down-objective-1"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="learn-v2-map-remove-objective"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('accepts from the bar when nothing is waiting', async () => {
    const { wrapper } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-accept-map"]').trigger('click')
    expect(wrapper.emitted('accept')).toHaveLength(1)
    wrapper.unmount()
  })

  it('never shows criteria, rubrics or weights to the learner', async () => {
    const { wrapper } = await mountTrail({ objectives: Array.from({ length: 7 }, (_, index) => objective(index, index === 2 ? { coverage: 'partial', gapReason: 'Partly covered.' } : {})) })

    await wrapper.get('[data-testid="learn-v2-map-select-objective-3"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-sources"]').trigger('click')
    expect(wrapper.text()).not.toMatch(/assess|criteri|rubric|weight|pass|score|grade|demonstrat|proof|mastery/i)
    wrapper.unmount()
  })
})
