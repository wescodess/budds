import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createFolder } from '../../support/factories/folder.factory'

describe('DashboardCourseCard — AC1: Course Card Display', () => {
  it.skip('[P0] should render folder name', async () => {
    const folder = createFolder({ name: 'Math 101' })
    const DashboardCourseCard = await import('~/components/dashboard/CourseCard.vue')

    const wrapper = await mountSuspended(DashboardCourseCard.default, {
      props: { folder, documentCount: folder.documentCount, lastActivity: folder._creationTime },
    })

    expect(wrapper.text()).toContain('Math 101')
  })

  it.skip('[P0] should display document count badge', async () => {
    const folder = createFolder({ documentCount: 5 })
    const DashboardCourseCard = await import('~/components/dashboard/CourseCard.vue')

    const wrapper = await mountSuspended(DashboardCourseCard.default, {
      props: { folder, documentCount: 5, lastActivity: folder._creationTime },
    })

    const badge = wrapper.find('[data-testid="folder-doc-count"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('5')
  })

  it.skip('[P0] should display last activity timestamp', async () => {
    const folder = createFolder()
    const DashboardCourseCard = await import('~/components/dashboard/CourseCard.vue')

    const wrapper = await mountSuspended(DashboardCourseCard.default, {
      props: { folder, documentCount: folder.documentCount, lastActivity: folder._creationTime },
    })

    const timestamp = wrapper.find('[data-testid="folder-last-activity"]')
    expect(timestamp.exists()).toBe(true)
    expect(timestamp.text()).toBeTruthy()
  })

  it.skip('[P0] should navigate to folder view on click', async () => {
    const folder = createFolder({ _id: 'folder_abc123' })
    const DashboardCourseCard = await import('~/components/dashboard/CourseCard.vue')

    const wrapper = await mountSuspended(DashboardCourseCard.default, {
      props: { folder, documentCount: folder.documentCount, lastActivity: folder._creationTime },
    })

    const card = wrapper.find('[data-testid="course-card"]')
    expect(card.exists()).toBe(true)

    const link = wrapper.find('a, [href]')
    expect(link.attributes('href') || link.attributes('to')).toContain('/app/folders/folder_abc123')
  })

  it.skip('[P1] should show quick action buttons (Chat and Cards)', async () => {
    const folder = createFolder()
    const DashboardCourseCard = await import('~/components/dashboard/CourseCard.vue')

    const wrapper = await mountSuspended(DashboardCourseCard.default, {
      props: { folder, documentCount: folder.documentCount, lastActivity: folder._creationTime },
    })

    const chatAction = wrapper.find('[data-testid="quick-action-chat"]')
    const cardsAction = wrapper.find('[data-testid="quick-action-cards"]')
    expect(chatAction.exists()).toBe(true)
    expect(cardsAction.exists()).toBe(true)
  })

  it.skip('[P1] should apply card background and border styling', async () => {
    const folder = createFolder()
    const DashboardCourseCard = await import('~/components/dashboard/CourseCard.vue')

    const wrapper = await mountSuspended(DashboardCourseCard.default, {
      props: { folder, documentCount: folder.documentCount, lastActivity: folder._creationTime },
    })

    const card = wrapper.find('[data-testid="course-card"]')
    expect(card.classes()).toEqual(expect.arrayContaining([expect.stringContaining('p-4')]))
  })
})
