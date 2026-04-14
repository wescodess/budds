import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useFolderLayout, __TEST_DEFAULTS__ } from '~/composables/useFolderLayout'

describe('useFolderLayout', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.useFakeTimers()
  })

  it('[P0] returns defaults when no localStorage entry exists', () => {
    const folderId = ref('folder-1')
    const layout = useFolderLayout(folderId)
    expect(layout.paneA.value).toBe(__TEST_DEFAULTS__.paneA)
    expect(layout.paneB.value).toBe(__TEST_DEFAULTS__.paneB)
    expect(layout.paneC.value).toBe(__TEST_DEFAULTS__.paneC)
    expect(layout.helperOpen.value).toBe(false)
    expect(layout.flipped.value).toBe(false)
  })

  it('[P0] loads stored values for a folder on mount', () => {
    window.localStorage.setItem(
      'budds:folder-layout:folder-2',
      JSON.stringify({ paneA: 30, paneB: 70, paneC: 25, helperOpen: true, flipped: true }),
    )
    const layout = useFolderLayout(ref('folder-2'))
    expect(layout.paneA.value).toBe(30)
    expect(layout.helperOpen.value).toBe(true)
    expect(layout.flipped.value).toBe(true)
  })

  it('[P0] falls back to defaults when stored JSON is malformed', () => {
    window.localStorage.setItem('budds:folder-layout:folder-3', '{not-json')
    const layout = useFolderLayout(ref('folder-3'))
    expect(layout.paneA.value).toBe(__TEST_DEFAULTS__.paneA)
  })

  it('[P0] persists changes to localStorage after debounce', async () => {
    const layout = useFolderLayout(ref('folder-4'))
    layout.paneA.value = 25
    layout.openHelper()
    await nextTick()
    vi.advanceTimersByTime(300)
    const raw = window.localStorage.getItem('budds:folder-layout:folder-4')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.paneA).toBe(25)
    expect(parsed.helperOpen).toBe(true)
  })

  it('[P0] reloads layout when folderId changes (per-folder isolation)', async () => {
    window.localStorage.setItem(
      'budds:folder-layout:folder-A',
      JSON.stringify({ paneA: 35, paneB: 65, paneC: 30, helperOpen: true, flipped: false }),
    )
    window.localStorage.setItem(
      'budds:folder-layout:folder-B',
      JSON.stringify({ paneA: 15, paneB: 85, paneC: 25, helperOpen: false, flipped: true }),
    )
    const folderId = ref('folder-A')
    const layout = useFolderLayout(folderId)
    expect(layout.paneA.value).toBe(35)
    folderId.value = 'folder-B'
    await nextTick()
    expect(layout.paneA.value).toBe(15)
    expect(layout.flipped.value).toBe(true)
  })

  it('[P1] flip toggles the flipped flag', () => {
    const layout = useFolderLayout(ref('folder-5'))
    expect(layout.flipped.value).toBe(false)
    layout.flip()
    expect(layout.flipped.value).toBe(true)
    layout.flip()
    expect(layout.flipped.value).toBe(false)
  })

  it('[P1] openHelper / closeHelper toggle helperOpen', () => {
    const layout = useFolderLayout(ref('folder-6'))
    layout.openHelper()
    expect(layout.helperOpen.value).toBe(true)
    layout.closeHelper()
    expect(layout.helperOpen.value).toBe(false)
  })
})
