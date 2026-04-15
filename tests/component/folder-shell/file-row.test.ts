import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { mockMatchMedia } from '../../support/match-media'

function dispatchPointer(target: Element, type: string, init: Record<string, unknown>) {
  const event = typeof PointerEvent === 'function'
    ? new PointerEvent(type, { bubbles: true, ...init })
    : Object.assign(new Event(type, { bubbles: true }), init)
  target.dispatchEvent(event)
}

describe('FolderShellFileRow', () => {
  const baseProps = {
    documentId: 'doc_1' as any,
    filename: 'notes.pdf',
    status: 'success' as const,
    fileSize: 1024 * 1024 * 2,
    createdAt: Date.now(),
  }

  beforeEach(() => {
    vi.resetModules()
    mockMatchMedia()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders filename and size subtitle in panel variant', async () => {
    const FolderShellFileRow = (await import('~/components/folder-shell/FolderShellFileRow.vue')).default
    const w = await mountSuspended(FolderShellFileRow, { props: baseProps })
    expect(w.text()).toContain('notes.pdf')
    expect(w.text()).toContain('PDF')
    expect(w.text()).toContain('MB')
  })

  it('renders list variant with status and size columns', async () => {
    const FolderShellFileRow = (await import('~/components/folder-shell/FolderShellFileRow.vue')).default
    const w = await mountSuspended(FolderShellFileRow, {
      props: { ...baseProps, variant: 'list' },
    })
    expect(w.text()).toContain('notes.pdf')
    expect(w.text()).toContain('Indexed')
  })

  it('shows Failed pill when status=failed', async () => {
    const FolderShellFileRow = (await import('~/components/folder-shell/FolderShellFileRow.vue')).default
    const w = await mountSuspended(FolderShellFileRow, {
      props: { ...baseProps, status: 'failed', failureReason: 'bad' },
    })
    expect(w.text()).toContain('Failed')
  })

  it('shows swipe-reveal document actions on touch devices', async () => {
    mockMatchMedia({ touch: true, mobile: true })

    const FolderShellFileRow = (await import('~/components/folder-shell/FolderShellFileRow.vue')).default
    const w = await mountSuspended(FolderShellFileRow, { props: baseProps })
    const actions = w.findAll('[data-swipe-reveal-action]')

    expect(actions).toHaveLength(2)
    expect(actions[0]?.text()).toContain('Move')
    expect(actions[1]?.text()).toContain('Delete')
  })

  it('shows dismiss-only swipe action for failed documents on touch devices', async () => {
    mockMatchMedia({ touch: true, mobile: true })

    const FolderShellFileRow = (await import('~/components/folder-shell/FolderShellFileRow.vue')).default
    const w = await mountSuspended(FolderShellFileRow, {
      props: { ...baseProps, status: 'failed', failureReason: 'bad' },
    })
    const actions = w.findAll('[data-swipe-reveal-action]')

    expect(actions).toHaveLength(1)
    expect(actions[0]?.text()).toContain('Dismiss')
  })

  it('emits long-press-select on touch long press', async () => {
    vi.useFakeTimers()
    mockMatchMedia({ touch: true, mobile: true })

    const FolderShellFileRow = (await import('~/components/folder-shell/FolderShellFileRow.vue')).default
    const w = await mountSuspended(FolderShellFileRow, { props: baseProps })
    const row = w.get('[data-testid="file-row-doc_1"]')

    dispatchPointer(row.element, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 24,
      clientY: 24,
    })

    await vi.advanceTimersByTimeAsync(500)

    dispatchPointer(row.element, 'pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 24,
      clientY: 24,
    })

    expect(w.emitted('long-press-select')).toEqual([['doc_1']])
  })
})
