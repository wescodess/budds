import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DefaultLayout from '~/layouts/default.vue'

describe('App Shell Layout — AC1/AC2: Study Mode Tabs', () => {
  it.skip('[P0] should render tabs with correct role attributes', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const tablist = wrapper.find('[role="tablist"]')
    expect(tablist.exists()).toBe(true)

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.length).toBe(4)
  })

  it.skip('[P0] should set Chat as the default active tab', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const activeTab = wrapper.find('[role="tab"][aria-selected="true"]')
    expect(activeTab.exists()).toBe(true)
    expect(activeTab.text()).toBe('Chat')
  })

  it.skip('[P1] should show placeholder content for Flash Cards tab', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const flashCardsTab = wrapper.findAll('[role="tab"]').find(t => t.text() === 'Flash Cards')
    expect(flashCardsTab).toBeDefined()

    await flashCardsTab!.trigger('click')

    const tabPanel = wrapper.find('[role="tabpanel"]')
    expect(tabPanel.text()).toContain('Coming soon')
  })

  it.skip('[P1] should show placeholder content for Quiz tab', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const quizTab = wrapper.findAll('[role="tab"]').find(t => t.text() === 'Quiz')
    expect(quizTab).toBeDefined()

    await quizTab!.trigger('click')

    const tabPanel = wrapper.find('[role="tabpanel"]')
    expect(tabPanel.text()).toContain('Coming soon')
  })

  it.skip('[P1] should show placeholder content for Documents tab', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const documentsTab = wrapper.findAll('[role="tab"]').find(t => t.text() === 'Documents')
    expect(documentsTab).toBeDefined()

    await documentsTab!.trigger('click')

    const tabPanel = wrapper.find('[role="tabpanel"]')
    expect(tabPanel.text()).toContain('Coming soon')
  })

  it.skip('[P0] should use primary amber accent for active tab indicator', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const activeTab = wrapper.find('[role="tab"][aria-selected="true"]')
    expect(activeTab.exists()).toBe(true)

    const tabEl = activeTab.element as HTMLElement
    const computedStyle = getComputedStyle(tabEl)
    expect(computedStyle.borderBottomColor).toBeTruthy()
  })
})
