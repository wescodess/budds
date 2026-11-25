import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mockMatchMedia } from '../../support/match-media'

const mode = ref<'light' | 'dark'>('light')
const folderThemeEnabled = ref(true)
const allFolders = ref<any[]>([])
const queryData = ref<any[]>([])

beforeAll(async () => { await import('~/components/folder-shell/FolderShell.vue') })

mockNuxtImport('useAppTheme', () => {
  return () => ({
    mode,
    folderThemeEnabled,
  })
})

mockNuxtImport('useFolders', () => {
  return () => ({
    allFolders,
  })
})

mockNuxtImport('useConvexQuery', () => {
  return () => ({
    data: queryData,
  })
})

const FolderShellRailStub = defineComponent({
  name: 'FolderShellRail',
  emits: ['toggle-mobile-expanded'],
  template: `
    <button type="button" data-testid="rail-toggle" @click="$emit('toggle-mobile-expanded')">
      Toggle rail
    </button>
  `,
})

const FolderShellHierarchyDrawerStub = defineComponent({
  name: 'FolderShellHierarchyDrawer',
  template: '<div data-testid="drawer-stub" />',
})

function ownFolderShellMount<T extends { unmount: () => void }>(create: (check: () => void) => Promise<T>): Promise<T> {
  let finished = false
  let wrapper: T | undefined
  const check = () => { if (finished) throw new Error('FolderShell fixture finished') }
  onTestFinished(() => { finished = true; wrapper?.unmount() })
  return create(check).then(mounted => {
    if (finished) { mounted.unmount(); check() }
    wrapper = mounted
    return mounted
  })
}

function mountFolderShell() {
  return ownFolderShellMount(async check => {
    const FolderShell = (await import('~/components/folder-shell/FolderShell.vue')).default
    check()

    return mountSuspended(FolderShell, {
      props: {
        folderId: 'folder-1' as any,
        folder: {
          _id: 'folder-1',
          name: 'Biology 101',
          color: null,
        } as any,
        activeTab: 'chat',
        activeConversationId: null,
        activeVoidId: null,
      },
      slots: {
        default: '<div data-testid="shell-content">Content</div>',
        'top-bar': '<div data-testid="top-bar">Top bar</div>',
      },
      global: {
        stubs: {
          FolderShellRail: FolderShellRailStub,
          FolderShellHierarchyDrawer: FolderShellHierarchyDrawerStub,
        },
      },
    })
  })
}

describe('FolderShell', () => {
  beforeEach(() => {
    mode.value = 'light'
    folderThemeEnabled.value = true
    allFolders.value = []
    queryData.value = []
    localStorage.clear()
    document.body.removeAttribute('style')
    document.body.removeAttribute('data-folder-theme')
  })

  it('[P1] keeps the mobile main pane untransformed when the rail expands', async () => {
    mockMatchMedia({ mobile: true })
    const wrapper = await mountFolderShell()

    expect(wrapper.get('[data-testid="folder-main-pane"]').attributes('style') ?? '').toBe('')

    await wrapper.get('[data-testid="rail-toggle"]').trigger('click')

    const style = wrapper.get('[data-testid="folder-main-pane"]').attributes('style') ?? ''
    expect(style).toContain('flex-basis: calc(100% - 4rem)')
    expect(style).toContain('min-width: calc(100% - 4rem)')
    expect(style).not.toContain('transform')
    expect(style).not.toContain('padding-left')
  })

  it('[P1] leaves the desktop main pane unshifted', async () => {
    mockMatchMedia({ mobile: false })
    const wrapper = await mountFolderShell()

    await wrapper.get('[data-testid="rail-toggle"]').trigger('click')

    expect(wrapper.get('[data-testid="folder-main-pane"]').attributes('style') ?? '').toBe('')
  })
})


describe('FolderShell fixture ownership', () => {
  const nextTestWork = vi.fn()
  let release: (wrapper: { unmount: () => void }) => void
  let result: Promise<unknown>

  beforeEach(() => { nextTestWork.mockReset() })

  it('owns a mount before its promise can settle', () => {
    const pending = new Promise<{ unmount: () => void }>(resolve => { release = resolve })
    result = ownFolderShellMount(() => pending).then(nextTestWork).catch(error => error)
  })

  it('unmounts a predecessor that resolves in the next test without continuing', async () => {
    const unmount = vi.fn()
    release({ unmount })
    expect(await result).toEqual(new Error('FolderShell fixture finished'))
    expect(unmount).toHaveBeenCalledTimes(1)
    expect(nextTestWork).not.toHaveBeenCalled()
  })
})
