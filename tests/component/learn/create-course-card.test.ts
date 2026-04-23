import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'CreateCourseCard.vue'].join('/')

describe('CreateCourseCard', () => {
  it('renders create course text', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.text()).toContain('Create Course')
  })

  it('renders plus icon', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.text()).toContain('+')
  })

  it('emits create event on click', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    const button = wrapper.find('[data-testid="create-course-card"]')
    await button.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
  })
})
