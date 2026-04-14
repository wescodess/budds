import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DefaultLayout from '~/layouts/default.vue'

describe('App Shell Layout — AC4: Dark/Light Mode', () => {
  it.skip('[P0] should use dark mode as the default theme', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const html = document.documentElement
    expect(html.classList.contains('dark')).toBe(true)
  })

  it.skip('[P0] should render a dark/light mode toggle button', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const toggleButton = wrapper.find('[data-testid="theme-toggle"]')
    expect(toggleButton.exists()).toBe(true)
  })

  it.skip('[P1] should switch to light mode when toggle is clicked', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const toggleButton = wrapper.find('[data-testid="theme-toggle"]')
    await toggleButton.trigger('click')

    const html = document.documentElement
    expect(html.classList.contains('dark')).toBe(false)
  })

  it.skip('[P1] should switch back to dark mode when toggle is clicked again', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const toggleButton = wrapper.find('[data-testid="theme-toggle"]')

    await toggleButton.trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    await toggleButton.trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
