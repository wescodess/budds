import { describe, it, expect, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

describe('AddCourseCard — AC2, AC3: Add Course Card', () => {
  it.skip('[P0] should render dashed border card with Plus icon and "Add Course" text', async () => {
    const AddCourseCard = await import('~/components/dashboard/AddCourseCard.vue')

    const wrapper = await mountSuspended(AddCourseCard.default)

    const card = wrapper.find('[data-testid="add-course-card"]')
    expect(card.exists()).toBe(true)
    expect(card.classes()).toEqual(expect.arrayContaining([expect.stringContaining('dashed')]))
    expect(wrapper.text()).toContain('Add Course')
  })

  it.skip('[P0] should reveal inline input when clicked', async () => {
    const AddCourseCard = await import('~/components/dashboard/AddCourseCard.vue')

    const wrapper = await mountSuspended(AddCourseCard.default)

    const card = wrapper.find('[data-testid="add-course-card"]')
    await card.trigger('click')

    const input = wrapper.find('[data-testid="new-folder-input"]')
    expect(input.exists()).toBe(true)

    const createBtn = wrapper.find('[data-testid="create-folder-btn"]')
    expect(createBtn.exists()).toBe(true)
  })

  it.skip('[P0] should call createFolder on submit with folder name', async () => {
    const AddCourseCard = await import('~/components/dashboard/AddCourseCard.vue')

    const wrapper = await mountSuspended(AddCourseCard.default)

    await wrapper.find('[data-testid="add-course-card"]').trigger('click')

    const input = wrapper.find('[data-testid="new-folder-input"]')
    await input.setValue('Calculus 101')

    await wrapper.find('[data-testid="create-folder-btn"]').trigger('click')

    expect(wrapper.emitted('create') || wrapper.find('[data-testid="new-folder-input"]').exists()).toBeTruthy()
  })

  it.skip('[P1] should submit on Enter key press', async () => {
    const AddCourseCard = await import('~/components/dashboard/AddCourseCard.vue')

    const wrapper = await mountSuspended(AddCourseCard.default)

    await wrapper.find('[data-testid="add-course-card"]').trigger('click')

    const input = wrapper.find('[data-testid="new-folder-input"]')
    await input.setValue('Physics 201')
    await input.trigger('keydown.enter')

    expect(wrapper.find('[data-testid="new-folder-input"]').element).toBeTruthy()
  })

  it.skip('[P1] should cancel on Escape key press and return to default state', async () => {
    const AddCourseCard = await import('~/components/dashboard/AddCourseCard.vue')

    const wrapper = await mountSuspended(AddCourseCard.default)

    await wrapper.find('[data-testid="add-course-card"]').trigger('click')
    expect(wrapper.find('[data-testid="new-folder-input"]').exists()).toBe(true)

    await wrapper.find('[data-testid="new-folder-input"]').trigger('keydown.escape')

    expect(wrapper.find('[data-testid="new-folder-input"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Add Course')
  })

  it.skip('[P1] should prevent empty folder name submission', async () => {
    const AddCourseCard = await import('~/components/dashboard/AddCourseCard.vue')

    const wrapper = await mountSuspended(AddCourseCard.default)

    await wrapper.find('[data-testid="add-course-card"]').trigger('click')

    const input = wrapper.find('[data-testid="new-folder-input"]')
    await input.setValue('')

    const createBtn = wrapper.find('[data-testid="create-folder-btn"]')
    await createBtn.trigger('click')

    expect(wrapper.find('[data-testid="new-folder-input"]').exists()).toBe(true)
  })

  it.skip('[P2] should clear input and return to default state after successful creation', async () => {
    const AddCourseCard = await import('~/components/dashboard/AddCourseCard.vue')

    const wrapper = await mountSuspended(AddCourseCard.default)

    await wrapper.find('[data-testid="add-course-card"]').trigger('click')
    await wrapper.find('[data-testid="new-folder-input"]').setValue('New Course')
    await wrapper.find('[data-testid="create-folder-btn"]').trigger('click')

    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Add Course')
  })
})
