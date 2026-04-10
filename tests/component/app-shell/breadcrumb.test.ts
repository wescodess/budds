import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DefaultLayout from '~/layouts/default.vue'

describe('App Shell Layout — AC1/AC5: Breadcrumb Navigation', () => {
  it.skip('[P0] should render breadcrumb with Home segment linking to /app', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const breadcrumb = wrapper.find('[data-testid="breadcrumb-nav"]')
    expect(breadcrumb.exists()).toBe(true)

    const homeLink = breadcrumb.find('a')
    expect(homeLink.exists()).toBe(true)
    expect(homeLink.text()).toContain('Home')
    expect(homeLink.attributes('href')).toBe('/app')
  })

  it.skip('[P1] should render breadcrumb segments as clickable links', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const breadcrumb = wrapper.find('[data-testid="breadcrumb-nav"]')
    const links = breadcrumb.findAll('a')
    expect(links.length).toBeGreaterThanOrEqual(1)

    links.forEach(link => {
      expect(link.attributes('href')).toBeTruthy()
    })
  })
})

describe('App Shell Layout — AC5: shadcn Component Availability', () => {
  it.skip('[P0] should have UiSidebar component available for rendering', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const sidebar = wrapper.findComponent({ name: 'UiSidebar' })
    expect(sidebar.exists()).toBe(true)
  })

  it.skip('[P0] should have UiTabs component available for rendering', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const tabs = wrapper.findComponent({ name: 'UiTabs' })
    expect(tabs.exists()).toBe(true)
  })

  it.skip('[P0] should have UiBreadcrumb component available for rendering', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const breadcrumb = wrapper.findComponent({ name: 'UiBreadcrumb' })
    expect(breadcrumb.exists()).toBe(true)
  })

  it.skip('[P1] should have UiSidebarTrigger component for mobile menu', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const trigger = wrapper.findComponent({ name: 'UiSidebarTrigger' })
    expect(trigger.exists()).toBe(true)
  })
})
