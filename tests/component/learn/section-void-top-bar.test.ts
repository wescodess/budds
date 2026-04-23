import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'SectionVoidTopBar.vue'].join('/')

const baseProps = {
  courseTitle: 'Organic Chemistry',
  sectionTitle: 'Nucleophilic Substitution',
  currentBlock: 2,
  totalBlocks: 5,
}

describe('SectionVoidTopBar', () => {
  it('renders section title', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    expect(wrapper.text()).toContain('Nucleophilic Substitution')
  })

  it('renders course title', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    expect(wrapper.text()).toContain('Organic Chemistry')
  })

  it('renders block progress indicator', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    expect(wrapper.text()).toContain('2/5')
  })

  it('renders progress bar with correct value', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const progressBar = wrapper.find('[role="progressbar"]')
    expect(progressBar.exists()).toBe(true)
    expect(progressBar.attributes('aria-valuenow')).toBe('40')
  })

  it('emits back event when back button clicked', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const backBtn = wrapper.find('[aria-label="Back to course"]')
    expect(backBtn.exists()).toBe(true)
    await backBtn.trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
  })

  it('handles zero blocks gracefully', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, currentBlock: 0, totalBlocks: 0 },
    })
    const progressBar = wrapper.find('[role="progressbar"]')
    expect(progressBar.attributes('aria-valuenow')).toBe('0')
  })

  it('has accessible progress label', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const progressBar = wrapper.find('[role="progressbar"]')
    expect(progressBar.attributes('aria-label')).toBe('Section progress: 40%')
  })
})
