import { ref, watch, type Ref } from 'vue'

export interface FolderLayoutState {
  paneA: number
  paneB: number
  paneC: number
  helperOpen: boolean
  flipped: boolean
}

const DEFAULT_LAYOUT: FolderLayoutState = {
  paneA: 18,
  paneB: 82,
  paneC: 28,
  helperOpen: false,
  flipped: false,
}

const STORAGE_PREFIX = 'budds:folder-layout:'

function storageKey(folderId: string): string {
  return `${STORAGE_PREFIX}${folderId}`
}

function readLayout(folderId: string): FolderLayoutState {
  if (!import.meta.client) return { ...DEFAULT_LAYOUT }
  try {
    const raw = window.localStorage.getItem(storageKey(folderId))
    if (!raw) return { ...DEFAULT_LAYOUT }
    const parsed = JSON.parse(raw) as Partial<FolderLayoutState>
    return {
      paneA: typeof parsed.paneA === 'number' ? parsed.paneA : DEFAULT_LAYOUT.paneA,
      paneB: typeof parsed.paneB === 'number' ? parsed.paneB : DEFAULT_LAYOUT.paneB,
      paneC: typeof parsed.paneC === 'number' ? parsed.paneC : DEFAULT_LAYOUT.paneC,
      helperOpen: typeof parsed.helperOpen === 'boolean' ? parsed.helperOpen : DEFAULT_LAYOUT.helperOpen,
      flipped: typeof parsed.flipped === 'boolean' ? parsed.flipped : DEFAULT_LAYOUT.flipped,
    }
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

function writeLayout(folderId: string, state: FolderLayoutState): void {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(storageKey(folderId), JSON.stringify(state))
  } catch {
    // quota or disabled storage — silently ignore
  }
}

export function useFolderLayout(folderId: Ref<string>) {
  const initial = readLayout(folderId.value)
  const paneA = ref(initial.paneA)
  const paneB = ref(initial.paneB)
  const paneC = ref(initial.paneC)
  const helperOpen = ref(initial.helperOpen)
  const flipped = ref(initial.flipped)

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleSave() {
    if (!import.meta.client) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      writeLayout(folderId.value, {
        paneA: paneA.value,
        paneB: paneB.value,
        paneC: paneC.value,
        helperOpen: helperOpen.value,
        flipped: flipped.value,
      })
    }, 250)
  }

  watch([paneA, paneB, paneC, helperOpen, flipped], scheduleSave)

  watch(folderId, (next) => {
    const loaded = readLayout(next)
    paneA.value = loaded.paneA
    paneB.value = loaded.paneB
    paneC.value = loaded.paneC
    helperOpen.value = loaded.helperOpen
    flipped.value = loaded.flipped
  })

  function setSizes(sizes: number[]) {
    if (sizes.length < 2) return
    const [a, b, c] = sizes
    if (typeof a === 'number') paneA.value = a
    if (typeof b === 'number') paneB.value = b
    if (typeof c === 'number') paneC.value = c
  }

  function openHelper() { helperOpen.value = true }
  function closeHelper() { helperOpen.value = false }
  function flip() { flipped.value = !flipped.value }

  return {
    paneA,
    paneB,
    paneC,
    helperOpen,
    flipped,
    setSizes,
    openHelper,
    closeHelper,
    flip,
  }
}

export const __TEST_DEFAULTS__ = DEFAULT_LAYOUT
