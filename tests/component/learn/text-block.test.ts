import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'TextBlock.vue'].join('/')

describe('TextBlock', () => {
  it('renders markdown content', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { content: 'This is a test paragraph.' },
    })
    expect(wrapper.text()).toContain('This is a test paragraph.')
  })

  it('renders bold text', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { content: 'This is **bold** text.' },
    })
    const strong = wrapper.find('strong')
    expect(strong.exists()).toBe(true)
    expect(strong.text()).toBe('bold')
  })

  it('renders headings', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { content: '## Section Heading' },
    })
    const heading = wrapper.find('h2')
    expect(heading.exists()).toBe(true)
    expect(heading.text()).toBe('Section Heading')
  })

  it('renders lists', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { content: '- Item one\n- Item two' },
    })
    const items = wrapper.findAll('li')
    expect(items.length).toBe(2)
  })

  it('shows explanation label', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { content: 'Test content' },
    })
    expect(wrapper.text()).toContain('Explanation')
  })

  it('handles empty content', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { content: '' },
    })
    expect(wrapper.find('[data-testid="text-block"]').exists()).toBe(true)
  })
})
