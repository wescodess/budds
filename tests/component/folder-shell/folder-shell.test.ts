import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mockMatchMedia } from '../../support/match-media'

const mode = ref<'light' | 'dark'>('light')
const allFolders = ref<any[]>([])
const queryData = ref<any[]>([])

mockNuxtImport('useAppTheme', () => {
  return () => ({
    mode,
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

async function mountFolderShell() {
  const FolderShell = (await import('~/components/folder-shell/FolderShell.vue')).default

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
}

describe('FolderShell', () => {
  beforeEach(() => {
    mode.value = 'light'
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
