import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
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

let observe: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined

class EditorObserver {
  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observe = callback }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

async function scrollEditor(inView: boolean) {
  observe?.([{ isIntersecting: inView }])
  await nextTick()
}

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

async function mountTrail(options: { objectives?: LearnObjectiveSnapshot[]; sources?: LearnSourceSnapshot[]; save?: (edit: LearnMapEdit) => Promise<LearnMapSaveResult>; canAccept?: boolean; loading?: boolean } = {}) {
  const Comp = await import(`${path}/LearningTrail.vue`)
  const save = vi.fn(options.save ?? (async () => ({ ok: true }) as LearnMapSaveResult))
  const wrapper = await mountSuspended(Comp.default, {
    props: { objectives: options.objectives ?? Array.from({ length: 7 }, (_, index) => objective(index)), sources: options.sources ?? sources, canAccept: options.canAccept ?? true, loading: options.loading ?? false, save },
    attachTo: document.body,
  })
  return { wrapper, save }
}

describe('Learner map editor', () => {
  beforeEach(() => vi.stubGlobal('IntersectionObserver', EditorObserver))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    observe = undefined
  })

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

  it('lists citations in ascending order in the outline and on the sources chip', async () => {
    const reversed = [sources[1]!, sources[0]!].map(source => ({ sourceKey: source.sourceKey, title: source.title, origin: source.origin, coverage: 'strong' as const, evidenceStatus: 'evidence_available' as const }))
    const { wrapper } = await mountTrail({ objectives: Array.from({ length: 7 }, (_, index) => objective(index, index === 1 ? { sourceLinks: reversed } : {})) })

    const row = wrapper.get('[data-testid="learn-v2-map-select-objective-2"]').element.closest('li')!
    expect([...row.querySelectorAll('a[aria-label^="Source"]')].map(link => link.textContent)).toEqual(['1', '2'])
    await wrapper.get('[data-testid="learn-v2-map-select-objective-2"]').trigger('click')
    const chip = wrapper.get('[data-testid="learn-v2-objective-sources"]')
    expect(chip.findAll('[aria-hidden="true"] > span').map(number => number.text())).toEqual(['1', '2'])
    expect(chip.text()).toContain('1 and 2')
    wrapper.unmount()
  })

  it('narrows Order to its icon and disclosure chevron so the bar stays on one row', async () => {
    const { wrapper } = await mountTrail()

    const order = wrapper.get('[data-testid="learn-v2-map-order"]')
    expect(order.element.parentElement!.parentElement!.classList).toContain('@container')
    expect(order.classes()).toEqual(expect.arrayContaining(['min-h-9', 'min-w-9']))
    expect(order.find('svg.text-primary').exists()).toBe(true)
    const label = order.findAll('span').find(span => span.text() === 'Order')!
    expect(label.classes()).toContain('@max-[21rem]:sr-only')
    const chevron = order.get('svg.lucide-chevron-up')
    expect(chevron.classes()).not.toContain('@max-[21rem]:hidden')
    expect(order.text()).toContain('Order')
    wrapper.unmount()
  })

  it('edits the words in place and saves one change without any assessment fields', async () => {
    const { wrapper, save } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-2"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Changes to this objective are saved together.')
    expect(wrapper.get('[data-testid="learn-v2-save-objective"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Explain cancellation safely')

    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Not saved yet: wording.')
    expect(wrapper.find('[data-testid="learn-v2-map-pending"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-accept-map"]').attributes('disabled')).toBeDefined()

    await scrollEditor(false)
    const pending = wrapper.get('[data-testid="learn-v2-map-pending"]')
    expect(pending.text()).toContain('Objective 2 isn’t saved yet.')
    expect(pending.get('a').text()).toBe('Go to it')
    expect(pending.get('svg').classes()).toContain('text-[var(--learn-attention)]')
    await scrollEditor(true)
    expect(wrapper.find('[data-testid="learn-v2-map-pending"]').exists()).toBe(false)

    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    const edit = save.mock.calls[0]![0]
    expect(edit).toMatchObject({ kind: 'save_objective', objective: { objectiveKey: 'objective-2', title: 'Explain cancellation safely', supportingSourceKeys: ['identity-1'] }, order: ['objective-1', 'objective-2', 'objective-3', 'objective-4', 'objective-5', 'objective-6', 'objective-7'] })
    expect(JSON.stringify(edit)).not.toMatch(/assessment|criteri|rubric|weight/i)
    wrapper.unmount()
  })

  it('names the objective in the bar while its status is under the bar', async () => {
    const { wrapper } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-2"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Explain cancellation safely')
    const status = wrapper.get('[data-testid="learn-v2-objective-status"]').element.parentElement!
    const bar = wrapper.get('[data-testid="learn-v2-accept-map"]').element.closest<HTMLElement>('.sticky')!
    let statusRect = rect(700, 740)
    vi.spyOn(status, 'getBoundingClientRect').mockImplementation(() => statusRect)
    vi.spyOn(bar, 'getBoundingClientRect').mockImplementation(() => rect(680, 768))
    window.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(wrapper.get('[data-testid="learn-v2-map-pending"]').text()).toContain('Objective 2 isn’t saved yet.')

    statusRect = rect(500, 540)
    window.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(wrapper.find('[data-testid="learn-v2-map-pending"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps held source changes out of the sources list until save', async () => {
    const { wrapper } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-2"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-sources"]').trigger('click')
    await wrapper.get('input[type="checkbox"][value="identity-2"]').setValue(true)
    await wrapper.get('[role="dialog"] [data-slot="button"]').trigger('click')

    expect(wrapper.get('[data-testid="learn-v2-objective-sources"]').text()).toContain('1 and 2')
    expect(wrapper.text()).toContain('Added by you · fetch.spec.whatwg.org')
    expect(wrapper.text()).not.toContain('fetch.spec.whatwg.org · backs')
    expect(wrapper.text()).toContain('Your folder · backs 1, 2, 3, 4, 5, 6, 7')
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

  it('shows two 15-minute parts and the added time before a short split is saved', async () => {
    const { wrapper } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    expect(wrapper.find('[data-testid="learn-v2-map-split-added"]').exists()).toBe(false)
    await wrapper.get('[data-testid="learn-v2-map-split-objective"]').trigger('click')
    expect(wrapper.get(`[id$="-chip-time"]`).text()).toBe('15 min, first part, change time')
    expect(wrapper.get('[data-testid="learn-v2-map-split-second-time"]').text()).toBe('15 min, second part')
    expect(wrapper.get('[data-testid="learn-v2-map-split-added"]').text()).toBe('Splitting adds 5 min so each part has the 15-minute minimum.')
    expect(wrapper.get('[data-testid="learn-v2-map-order"]').text()).toContain('about 3 hr')

    await wrapper.get('[data-testid="learn-v2-map-split-objective"]').trigger('click')
    expect(wrapper.find('[data-testid="learn-v2-map-split-second-time"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('edits the first part’s minutes while a split is held', async () => {
    const { wrapper, save } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-map-split-objective"]').trigger('click')
    await wrapper.findAll('[aria-expanded]').find(chip => chip.text().includes('change time'))!.trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Time for objective 1, first part')
    const input = wrapper.get('[data-testid="learn-v2-objective-effort"]')
    expect((input.element as HTMLInputElement).value).toBe('15')

    await input.setValue('20')
    expect(wrapper.get(`[id$="-chip-time"]`).text()).toBe('20 min, first part, change time')
    expect(wrapper.get('[data-testid="learn-v2-map-split-second-time"]').text()).toBe('15 min, second part')
    expect(wrapper.find('[data-testid="learn-v2-map-split-added"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-map-order"]').text()).toContain('about 3 hr 5 min')

    await input.setValue('14')
    expect(wrapper.get('[data-testid="learn-v2-save-objective"]').attributes('disabled')).toBeDefined()
    await input.setValue('40')
    expect(wrapper.get('[data-testid="learn-v2-map-split-second-time"]').text()).toBe('15 min, second part')
    expect(wrapper.get('[data-testid="learn-v2-map-order"]').text()).toContain('about 3 hr 25 min')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    expect(save.mock.calls[0]![0]).toMatchObject({ kind: 'save_objective', objective: { effortMinutes: 40 }, split: { minutes: [40, 15] } })
    wrapper.unmount()
  })

  it('validates the split parts shown, not the cleared time before the split', async () => {
    const { wrapper, save } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[id$="-chip-time"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-effort"]').setValue('')
    await wrapper.get('[data-testid="learn-v2-map-split-objective"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-effort"]').setValue('20')
    expect(wrapper.get('[id$="-chip-time"]').text()).toBe('20 min, first part, change time')
    expect(wrapper.get('[data-testid="learn-v2-map-split-second-time"]').text()).toBe('15 min, second part')
    expect(wrapper.get('[data-testid="learn-v2-map-order"]').text()).toContain('about 3 hr 5 min')
    expect(wrapper.get('[data-testid="learn-v2-save-objective"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    expect(save.mock.calls[0]![0]).toMatchObject({ kind: 'save_objective', objective: { effortMinutes: 20 }, split: { minutes: [20, 15] } })
    wrapper.unmount()
  })

  it('stops ticking sources at the 10 an objective can use', async () => {
    const many: LearnSourceSnapshot[] = Array.from({ length: 11 }, (_, index) => ({ id: `source-${index + 1}`, sourceKey: `identity-${index + 1}`, title: `Source ${index + 1}`, origin: 'folder_document', retrievedLabel: 'Accepted', coverage: 'strong', lifecycle: 'user_accepted', objectives: [] }))
    const links = many.slice(0, 9).map(source => ({ sourceKey: source.sourceKey, title: source.title, origin: source.origin, coverage: 'strong' as const, evidenceStatus: 'evidence_available' as const }))
    const { wrapper } = await mountTrail({ sources: many, objectives: Array.from({ length: 6 }, (_, index) => objective(index, index ? {} : { sourceLinks: links })) })

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-sources"]').trigger('click')
    const box = (key: string) => wrapper.get(`input[type="checkbox"][value="${key}"]`)
    expect(wrapper.find('[data-testid="learn-v2-map-sources-full"]').exists()).toBe(false)
    await box('identity-10').setValue(true)
    expect(wrapper.get('[data-testid="learn-v2-map-sources-full"]').text()).toBe('An objective can use up to 10 sources. Untick one to add another.')
    expect(box('identity-11').attributes('disabled')).toBeDefined()
    expect(box('identity-10').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="learn-v2-save-objective"]').attributes('disabled')).toBeUndefined()
    await box('identity-1').setValue(false)
    expect(wrapper.find('[data-testid="learn-v2-map-sources-full"]').exists()).toBe(false)
    expect(box('identity-11').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('holds Save when the map would use sources more than 60 times, including from a split', async () => {
    const many: LearnSourceSnapshot[] = Array.from({ length: 10 }, (_, index) => ({ id: `source-${index + 1}`, sourceKey: `identity-${index + 1}`, title: `Source ${index + 1}`, origin: 'folder_document', retrievedLabel: 'Accepted', coverage: 'strong', lifecycle: 'user_accepted', objectives: [] }))
    const links = (count: number) => many.slice(0, count).map(source => ({ sourceKey: source.sourceKey, title: source.title, origin: source.origin, coverage: 'strong' as const, evidenceStatus: 'evidence_available' as const }))
    const { wrapper } = await mountTrail({ sources: many, objectives: Array.from({ length: 6 }, (_, index) => objective(index, { sourceLinks: links(index === 5 ? 5 : 10) })) })
    const saveButton = () => wrapper.get('[data-testid="learn-v2-save-objective"]')

    await wrapper.get('[data-testid="learn-v2-map-select-objective-6"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-map-split-objective"]').trigger('click')
    expect(saveButton().attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="learn-v2-map-links-full"]').exists()).toBe(false)

    await wrapper.get('[data-testid="learn-v2-objective-sources"]').trigger('click')
    await wrapper.get('input[type="checkbox"][value="identity-6"]').setValue(true)
    const reason = wrapper.get('[data-testid="learn-v2-map-links-full"]')
    expect(reason.text()).toBe('A map can use sources up to 60 times across its objectives. Untick a source to save.')
    expect(saveButton().attributes('disabled')).toBeDefined()
    expect(saveButton().attributes('aria-describedby')).toBe(reason.attributes('id'))

    await wrapper.get('[data-testid="learn-v2-map-split-objective"]').trigger('click')
    expect(wrapper.find('[data-testid="learn-v2-map-links-full"]').exists()).toBe(false)
    expect(saveButton().attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('holds time to the 15 to 480 minute range the map saves with', async () => {
    const { wrapper } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.findAll('[aria-expanded]').find(chip => chip.text().includes('change time'))!.trigger('click')
    const input = wrapper.get('[data-testid="learn-v2-objective-effort"]')
    expect(input.attributes()).toMatchObject({ min: '15', max: '480' })
    expect(wrapper.get('[role="dialog"]').text()).toContain('15 to 480')
    for (const [value, enabled] of [['5', false], ['14', false], ['15', true], ['480', true], ['481', false]] as const) {
      await input.setValue(value)
      expect(wrapper.get('[data-testid="learn-v2-save-objective"]').attributes('disabled') === undefined).toBe(enabled)
    }
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
    expect(wrapper.find('[data-testid="learn-v2-map-pending"]').exists()).toBe(false)
    await scrollEditor(false)
    expect(wrapper.get('[data-testid="learn-v2-map-pending"]').text()).toContain('Saving objective 1…')
    expect(wrapper.get('[data-testid="learn-v2-map-pending"]').text()).not.toContain('isn’t saved')
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

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe('Couldn’t save objective 2. Your changes are still here. Try again.')
    expect(alert.classes()).toContain('text-foreground')
    expect(alert.classes()).not.toContain('text-destructive')
    expect(alert.get('svg').classes()).toContain('text-destructive')
    expect(wrapper.get('[data-testid="learn-v2-objective-status"]').text()).toBe('Not saved. Your changes are still here.')
    expect((wrapper.get('[data-testid="learn-v2-objective-title"]').element as HTMLTextAreaElement).value).toBe('Explain cancellation')
    expect(wrapper.find('[data-testid="learn-v2-map-reload"]').exists()).toBe(false)

    await scrollEditor(false)
    const bar = wrapper.get('[data-testid="learn-v2-map-pending"]')
    expect(bar.text()).toBe('Couldn’t save objective 2. Go to it')
    expect(bar.classes()).toContain('text-foreground')
    expect(bar.get('svg').classes()).toContain('text-destructive')
    wrapper.unmount()
  })

  it('offers one way on when the map changed somewhere else', async () => {
    const { wrapper } = await mountTrail({ save: async () => ({ ok: false, reason: 'changed' }) })

    await wrapper.get('[data-testid="learn-v2-map-select-objective-2"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Explain cancellation')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await wrapper.vm.$nextTick()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('The map changed somewhere else, so objective 2 wasn’t saved. Your changes are still here.')
    expect(alert.classes()).not.toContain('text-destructive')
    expect(alert.get('svg').classes()).toContain('text-destructive')

    await scrollEditor(false)
    const bar = wrapper.get('[data-testid="learn-v2-map-pending"]')
    expect(bar.text()).toBe('Objective 2 wasn’t saved. The map changed. Go to it')
    expect(bar.classes()).toContain('text-foreground')
    expect(bar.get('svg').classes()).toContain('text-destructive')
    await scrollEditor(true)

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
    const partly = wrapper.get('input[type="radio"][value="partial"]').element.parentElement!
    expect(partly.className).toContain('border-2')
    expect(partly.className).toContain('has-[:checked]:border-primary')
    expect(partly.className).toContain('has-[:checked]:bg-primary/8')
    expect(partly.className).toContain('has-[:checked]:font-medium')
    expect(partly.className).toContain('text-foreground')
    expect(partly.className).toContain('has-[:focus-visible]:ring-offset-2')
    expect(partly.className).not.toMatch(/has-\[:checked\]:bg-(accent|primary)(\s|$)/)
    const coverage = wrapper.findAll('[role="radiogroup"][aria-label="Do your sources cover this?"] label')
    expect(coverage.map(segment => segment.find('svg.lucide-check').exists())).toEqual([false, true, false])
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
    await wrapper.get('[data-testid="learn-v2-map-order"]').trigger('click', { detail: 1 })
    await wrapper.vm.$nextTick()
    const order = wrapper.get('[role="dialog"][aria-label="Order of objectives"]')
    expect(order.text()).toContain('Order · 7 objectives')
    expect(order.get('[aria-current="true"]').text()).toContain('Objective 3')
    expect(order.text()).toContain('Not covered yet')
    expect(document.activeElement).toBe(order.element)
    await order.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[aria-label="Order of objectives"]').exists()).toBe(false)

    await wrapper.get('[data-testid="learn-v2-map-order"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(wrapper.get('[role="dialog"][aria-label="Order of objectives"] [aria-current="true"]').element)
    wrapper.unmount()
  })

  it('marks the objective in view in the order list, not the selected one, and follows scrolling', async () => {
    const { wrapper } = await mountTrail()

    await wrapper.get('[data-testid="learn-v2-map-select-objective-3"]').trigger('click')
    let shift = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('sticky')) return rect(680, 768)
      if (this.id.endsWith('-objective-objective-6')) return rect(300 - shift, 420 - shift)
      if (this.id.endsWith('-objective-objective-7')) return rect(420 - shift, 540 - shift)
      return this.id.includes('-objective-') ? rect(1200, 1300) : rect(0, 0)
    })
    await wrapper.get('[data-testid="learn-v2-map-order"]').trigger('click', { detail: 1 })
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[aria-label="Order of objectives"] [aria-current="true"]').text()).toContain('Objective 6')

    shift = 120
    window.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[aria-label="Order of objectives"] [aria-current="true"]').text()).toContain('Objective 7')
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
    await empty.get('[data-testid="learn-v2-map-empty-sources"]').trigger('click')
    expect(wrapper.emitted('manageSources')).toHaveLength(1)
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
