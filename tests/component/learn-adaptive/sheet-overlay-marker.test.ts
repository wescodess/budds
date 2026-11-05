import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { h } from 'vue'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { LEARN_ADAPTIVE_SURFACE } from '~/utils/learn-adaptive-surface'

async function mountSheet(contentProps: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended({ render: () => h(Sheet, { open: true }, () => h(SheetContent, { 'data-testid': 'sheet', ...contentProps }, () => [h(SheetTitle, () => 'Title'), h(SheetDescription, () => 'Description')])) }, { attachTo: document.body })
  await vi.waitFor(() => expect(document.querySelector('[data-testid="sheet"]')).not.toBeNull())
  return wrapper
}

describe('SheetContent overlay extension', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('leaves other sheet consumers without adaptive markers', async () => {
    const wrapper = await mountSheet()
    const overlay = document.querySelector('[data-slot="sheet-overlay"]')!
    const content = document.querySelector('[data-testid="sheet"]')!
    expect(overlay.className).not.toContain('learn-adaptive-surface')
    expect(content.className).not.toContain('learn-adaptive-surface')
    expect(content.querySelector('[data-slot="sheet-close"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('marks the portalled overlay without forwarding the prop to the dialog', async () => {
    const wrapper = await mountSheet({ overlayClass: LEARN_ADAPTIVE_SURFACE, class: LEARN_ADAPTIVE_SURFACE })
    const overlay = document.querySelector('[data-slot="sheet-overlay"]')!
    const content = document.querySelector('[data-testid="sheet"]')!
    expect(overlay.classList).toContain('learn-adaptive-surface')
    expect(overlay.classList).toContain('bg-black/80')
    expect(content.classList).toContain('learn-adaptive-surface')
    expect(content.closest('.learn-adaptive-surface')).toBe(content)
    expect(content.hasAttribute('overlay-class')).toBe(false)
    expect(content.hasAttribute('overlayclass')).toBe(false)
    wrapper.unmount()
  })

  it('keeps every surface utility through class merging', async () => {
    const wrapper = await mountSheet({ overlayClass: LEARN_ADAPTIVE_SURFACE, class: LEARN_ADAPTIVE_SURFACE })
    const content = document.querySelector('[data-testid="sheet"]')!
    for (const utility of LEARN_ADAPTIVE_SURFACE.split(' ')) expect(content.classList).toContain(utility)
    wrapper.unmount()
  })
})
