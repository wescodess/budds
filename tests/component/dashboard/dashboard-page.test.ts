import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createFolders } from '../../support/factories/folder.factory'

describe('Dashboard Page — AC1: Card Grid with Folders', () => {
  it.skip('[P0] should render "Your Courses" heading', async () => {
    const DashboardPage = await import('~/pages/app/index.vue')

    const wrapper = await mountSuspended(DashboardPage.default)

    expect(wrapper.text()).toContain('Your Courses')
  })

  it.skip('[P0] should render course cards for each folder', async () => {
    const DashboardPage = await import('~/pages/app/index.vue')

    const wrapper = await mountSuspended(DashboardPage.default)

    const courseCards = wrapper.findAll('[data-testid="course-card"]')
    expect(courseCards.length).toBeGreaterThan(0)
  })

  it.skip('[P0] should render AddCourseCard as the last card when folders exist', async () => {
    const DashboardPage = await import('~/pages/app/index.vue')

    const wrapper = await mountSuspended(DashboardPage.default)

    const addCard = wrapper.find('[data-testid="add-course-card"]')
    expect(addCard.exists()).toBe(true)
  })

  it.skip('[P1] should apply responsive grid classes (1 col mobile, 2 tablet, 3 desktop)', async () => {
    const DashboardPage = await import('~/pages/app/index.vue')

    const wrapper = await mountSuspended(DashboardPage.default)

    const grid = wrapper.find('[data-testid="courses-grid"]')
    expect(grid.exists()).toBe(true)
    expect(grid.classes()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('grid'),
        expect.stringContaining('grid-cols-1'),
        expect.stringContaining('md:grid-cols-2'),
        expect.stringContaining('xl:grid-cols-3'),
      ]),
    )
  })
})

describe('Dashboard Page — AC2: Empty State for First-Time Users', () => {
  it.skip('[P0] should show empty state with "Start by creating a course folder" when no folders', async () => {
    const DashboardPage = await import('~/pages/app/index.vue')

    const wrapper = await mountSuspended(DashboardPage.default)

    const emptyState = wrapper.find('[data-testid="dashboard-empty-state"]')
    expect(emptyState.exists()).toBe(true)
    expect(emptyState.text()).toContain('Start by creating a course folder')
  })

  it.skip('[P0] should show FolderOpen icon in empty state', async () => {
    const DashboardPage = await import('~/pages/app/index.vue')

    const wrapper = await mountSuspended(DashboardPage.default)

    const icon = wrapper.find('[data-testid="empty-state-icon"]')
    expect(icon.exists()).toBe(true)
  })

  it.skip('[P0] should show inline folder name input with create button in empty state', async () => {
    const DashboardPage = await import('~/pages/app/index.vue')

    const wrapper = await mountSuspended(DashboardPage.default)

    const input = wrapper.find('[data-testid="empty-state-input"]')
    expect(input.exists()).toBe(true)

    const createBtn = wrapper.find('[data-testid="empty-state-create-btn"]')
    expect(createBtn.exists()).toBe(true)
  })
})

describe('Dashboard Page — Loading State', () => {
  it.skip('[P0] should show 3 skeleton cards while loading', async () => {
    const DashboardPage = await import('~/pages/app/index.vue')

    const wrapper = await mountSuspended(DashboardPage.default)

    const skeletons = wrapper.findAll('[data-testid="skeleton-card"]')
    expect(skeletons).toHaveLength(3)
  })
})

describe('Dashboard Layout — AC1: Slot Outside Tabs on Dashboard Route', () => {
  it.skip('[P0] should render page content outside UiTabs when on /app route', async () => {
    const DefaultLayout = await import('~/layouts/default.vue')

    const wrapper = await mountSuspended(DefaultLayout.default, {
      slots: {
        default: '<div data-testid="dashboard-content">Dashboard</div>',
      },
    })

    const dashboardContent = wrapper.find('[data-testid="dashboard-content"]')
    expect(dashboardContent.exists()).toBe(true)

    const tabsContent = wrapper.find('[role="tabpanel"]')
    if (tabsContent.exists()) {
      expect(tabsContent.find('[data-testid="dashboard-content"]').exists()).toBe(false)
    }
  })

  it.skip('[P1] should show breadcrumb with "Home" as current page (non-linked) on /app', async () => {
    const DefaultLayout = await import('~/layouts/default.vue')

    const wrapper = await mountSuspended(DefaultLayout.default)

    const breadcrumb = wrapper.find('[data-testid="breadcrumb-nav"]')
    expect(breadcrumb.exists()).toBe(true)
    expect(breadcrumb.text()).toContain('Home')
  })
})
