import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const path = ['~', 'components', 'chat', 'ReferenceChips.vue'].join('/')

const sources = [
  { filename: 'a.pdf', content: 'x', score: 0.9 },
  { filename: 'b.pdf', content: 'y', score: 0.8 },
  { filename: 'c.pdf', content: 'z', score: 0.7 },
  { filename: 'd.pdf', content: 'w', score: 0.6 },
]

describe('ChatReferenceChips', () => {
  it('renders nothing when no sources', async () => {
    const Comp = await import(path)
    const wrapper = await mountSuspended(Comp.default, { props: { sources: [] } })
    expect(wrapper.find('[data-testid="chat-reference-chips"]').exists()).toBe(false)
  })

  it('renders up to maxPreview chips plus overflow counter', async () => {
    const Comp = await import(path)
    const wrapper = await mountSuspended(Comp.default, { props: { sources, maxPreview: 3 } })
    expect(wrapper.text()).toContain('a.pdf')
    expect(wrapper.text()).toContain('b.pdf')
    expect(wrapper.text()).toContain('c.pdf')
    expect(wrapper.text()).toContain('+1 more')
  })

  it('emits view-all when the view-all button is clicked', async () => {
    const Comp = await import(path)
    const wrapper = await mountSuspended(Comp.default, { props: { sources } })
    await wrapper.find('[data-testid="view-all-references"]').trigger('click')
    expect(wrapper.emitted('view-all')?.length).toBe(1)
  })

  it('emits chip-click with 1-based index', async () => {
    const Comp = await import(path)
    const wrapper = await mountSuspended(Comp.default, { props: { sources } })
    const chipButtons = wrapper.findAll('button[type="button"]').filter(b => b.text().includes('a.pdf'))
    expect(chipButtons.length).toBeGreaterThan(0)
    await chipButtons[0]!.trigger('click')
    expect(wrapper.emitted('chip-click')?.[0]).toEqual([1])
  })
})
