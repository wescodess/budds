import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DefaultLayout from '~/layouts/default.vue'

describe('App Shell Layout — AC2: Mobile (<768px)', () => {
  it.skip('[P0] should hide sidebar by default on mobile', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const sidebar = wrapper.find('[data-testid="app-sidebar"]')
    expect(sidebar.exists()).toBe(true)

    const sidebarEl = sidebar.element as HTMLElement
    const computedStyle = getComputedStyle(sidebarEl)
    expect(
      computedStyle.display === 'none' ||
      sidebarEl.hasAttribute('data-state') && sidebarEl.getAttribute('data-state') === 'closed'
    ).toBe(true)
  })

  it.skip('[P0] should render a menu button that opens sidebar as Sheet overlay on mobile', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const menuButton = wrapper.find('[data-testid="sidebar-trigger"]')
    expect(menuButton.exists()).toBe(true)

    await menuButton.trigger('click')

    const sheetOverlay = wrapper.find('[data-testid="sidebar-sheet"]')
    expect(sheetOverlay.exists()).toBe(true)
  })

  it.skip('[P1] should allow horizontal scrolling of study mode tabs on mobile', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const tabContainer = wrapper.find('[data-testid="tabs-container"]')
    expect(tabContainer.exists()).toBe(true)

    const tabEl = tabContainer.element as HTMLElement
    const computedStyle = getComputedStyle(tabEl)
    expect(computedStyle.overflowX).toBe('auto')
  })

  it.skip('[P1] should render breadcrumb with back arrow on mobile', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const mobileBreadcrumb = wrapper.find('[data-testid="breadcrumb-mobile"]')
    expect(mobileBreadcrumb.exists()).toBe(true)

    const backArrow = wrapper.find('[data-testid="breadcrumb-back"]')
    expect(backArrow.exists()).toBe(true)
  })
})

describe('App Shell Layout — AC3: Tablet (768-1024px)', () => {
  it.skip('[P1] should render sidebar as visible on tablet breakpoint', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const sidebar = wrapper.find('[data-testid="app-sidebar"]')
    expect(sidebar.exists()).toBe(true)
  })

  it.skip('[P2] should not render source panel on tablet breakpoint', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const sourcePanel = wrapper.find('[data-testid="source-panel"]')
    expect(sourcePanel.exists()).toBe(false)
  })
})

describe('App Shell Layout — AC1: Desktop (>1024px)', () => {
  it.skip('[P0] should render sidebar with w-64 width on desktop', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const sidebar = wrapper.find('[data-testid="app-sidebar"]')
    expect(sidebar.exists()).toBe(true)
    expect(sidebar.classes()).toContain('w-64')
  })

  it.skip('[P0] should fill remaining width with main content on desktop', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const mainContent = wrapper.find('[data-testid="main-content"]')
    expect(mainContent.exists()).toBe(true)
  })
})
