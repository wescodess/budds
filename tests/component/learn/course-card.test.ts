import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'CourseCard.vue'].join('/')

const baseCourse = {
  _id: 'course_123',
  folderId: 'folder_456',
  title: 'Organic Chemistry',
  completedSectionCount: 5,
  totalSectionCount: 12,
  pace: 'intensive' as const,
  status: 'ready',
}

describe('CourseCard', () => {
  it('renders course title', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { course: baseCourse } })
    expect(wrapper.text()).toContain('Organic Chemistry')
  })

  it('renders section count', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { course: baseCourse } })
    expect(wrapper.text()).toContain('5/12 sections')
  })

  it('renders progress bar with correct width', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { course: baseCourse } })
    const progressBar = wrapper.find('[role="progressbar"]')
    expect(progressBar.exists()).toBe(true)
    expect(progressBar.attributes('aria-valuenow')).toBe('42')
  })

  it('renders intensive pace badge', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { course: baseCourse } })
    const badge = wrapper.find('[data-testid="pace-badge"]')
    expect(badge.text()).toBe('Intensive')
  })

  it('renders steady pace badge', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { course: { ...baseCourse, pace: 'steady' } },
    })
    const badge = wrapper.find('[data-testid="pace-badge"]')
    expect(badge.text()).toBe('Steady')
  })

  it('renders relaxed pace badge', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { course: { ...baseCourse, pace: 'relaxed' } },
    })
    const badge = wrapper.find('[data-testid="pace-badge"]')
    expect(badge.text()).toBe('Relaxed')
  })

  it('handles zero sections gracefully', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { course: { ...baseCourse, completedSectionCount: 0, totalSectionCount: 0 } },
    })
    const progressBar = wrapper.find('[role="progressbar"]')
    expect(progressBar.attributes('aria-valuenow')).toBe('0')
  })

  it('links to course page', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { course: baseCourse } })
    const link = wrapper.find('a')
    expect(link.attributes('href')).toContain('/app/folders/folder_456/learn/course_123')
  })

  it('shows no status badge for ready courses', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { course: baseCourse } })
    const badge = wrapper.find('[data-testid="status-badge"]')
    expect(badge.exists()).toBe(false)
  })

  it('shows generating badge for generating courses', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { course: { ...baseCourse, status: 'generating' } },
    })
    const badge = wrapper.find('[data-testid="status-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('Generating...')
    expect(badge.classes()).toEqual(expect.arrayContaining(['text-amber-400']))
  })

  it('shows failed badge for failed courses', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { course: { ...baseCourse, status: 'failed' } },
    })
    const badge = wrapper.find('[data-testid="status-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('Failed')
    expect(badge.classes()).toEqual(expect.arrayContaining(['text-red-400']))
  })

  it('applies dimmed styling for failed courses', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { course: { ...baseCourse, status: 'failed' } },
    })
    const link = wrapper.find('a')
    expect(link.classes()).toEqual(expect.arrayContaining(['opacity-75']))
    const title = wrapper.find('h3')
    expect(title.classes()).toEqual(expect.arrayContaining(['text-stone-400']))
  })

  it('shows durable deletion progress and disables navigation', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { course: { ...baseCourse, status: 'deleting' } },
    })
    const link = wrapper.find('a')
    expect(wrapper.find('[data-testid="status-badge"]').text()).toBe('Deleting...')
    expect(link.attributes('aria-disabled')).toBe('true')
    expect(link.classes()).toEqual(expect.arrayContaining(['pointer-events-none', 'opacity-75']))
  })
})
