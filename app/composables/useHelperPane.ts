import type { Component } from 'vue'

export interface HelperTab {
  id: string
  label: string
  icon: Component
}

interface HelperPaneState {
  tabs: HelperTab[]
  activeTabId: string | null
}

const state = reactive<HelperPaneState>({
  tabs: [],
  activeTabId: null,
})

export function useHelperPane() {
  const isOpen = computed(() => state.activeTabId !== null)
  const activeTabId = computed(() => state.activeTabId)
  const tabs = computed(() => state.tabs)

  const activeTab = computed(() =>
    state.activeTabId
      ? state.tabs.find(t => t.id === state.activeTabId) ?? null
      : null,
  )

  function register(tab: HelperTab) {
    if (!state.tabs.some(t => t.id === tab.id)) {
      state.tabs.push(tab)
    }
  }

  function unregister(id: string) {
    state.tabs = state.tabs.filter(t => t.id !== id)
    if (state.activeTabId === id) {
      state.activeTabId = null
    }
  }

  function open(id: string) {
    if (!state.tabs.some(t => t.id === id)) return
    state.activeTabId = id
  }

  function close() {
    state.activeTabId = null
  }

  function toggle(id: string) {
    if (state.activeTabId === id) {
      close()
    } else {
      open(id)
    }
  }

  function focus(id: string) {
    if (state.tabs.some(t => t.id === id)) {
      state.activeTabId = id
    }
  }

  return {
    isOpen,
    activeTabId,
    activeTab,
    tabs,
    register,
    unregister,
    open,
    close,
    toggle,
    focus,
  }
}
