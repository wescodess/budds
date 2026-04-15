import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mockMatchMedia } from '../../support/match-media'

describe('FoldersIconSelect', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = ''
    mockMatchMedia()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('[P1] renders the icon picker in a drawer on touch devices', async () => {
    mockMatchMedia({ touch: true, mobile: true })
    const IconSelect = (await import('~/components/folders/IconSelect.vue')).default

    const wrapper = await mountSuspended(IconSelect, {
      props: {
        modelValue: 'folder',
        colorHex: '#2563eb',
      },
      attachTo: document.body,
    })

    await wrapper.get('[data-testid="folder-icon-select"]').trigger('click')
    await flushPromises()

    const drawer = document.body.querySelector('[data-testid="folder-icon-drawer"]')
    const search = document.body.querySelector<HTMLInputElement>('[data-testid="folder-icon-search"]')

    expect(drawer).not.toBeNull()
    expect(search?.type).toBe('search')
    expect(search?.getAttribute('inputmode')).toBe('search')
    expect(search?.getAttribute('enterkeyhint')).toBe('search')
    expect(search?.getAttribute('autocapitalize')).toBe('none')
    expect(search?.getAttribute('autocorrect')).toBe('off')
    expect(search?.getAttribute('spellcheck')).toBe('false')
    expect(search?.getAttribute('autocomplete')).toBe('off')
  })

  it('[P1] keeps the desktop picker out of drawer mode', async () => {
    mockMatchMedia({ touch: false, mobile: false })
    const IconSelect = (await import('~/components/folders/IconSelect.vue')).default

    const wrapper = await mountSuspended(IconSelect, {
      props: {
        modelValue: 'folder',
        colorHex: '#2563eb',
      },
      attachTo: document.body,
    })

    await wrapper.get('[data-testid="folder-icon-select"]').trigger('click')
    await flushPromises()

    expect(document.body.querySelector('[data-testid="folder-icon-drawer"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="folder-icon-search"]')).not.toBeNull()
  })
})
