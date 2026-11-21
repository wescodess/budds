import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'

const roomData = ref<any>(null)
const roomError = ref<unknown>(null)
const versionsData = ref<any>(null)
const versionsError = ref<unknown>(null)
const roomContent = {
  room: { _id: 'room_1', _creationTime: Date.now(), title: 'Cell Biology', userId: 'user_a', folderId: 'folder_abc', updatedAt: Date.now() },
  cards: [{ _id: 'c1', displayOrder: 0, term: 'Mitosis', definition: 'Cell division' }],
}
const refreshRoom = vi.fn(async () => { roomError.value = null; roomData.value = roomContent })
const refreshVersions = vi.fn(async () => { versionsError.value = null; versionsData.value = [] })

const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })

mockNuxtImport('useConvexQuery', () => (apiRef: any) => {
  const name = getFunctionName(apiRef) ?? ''
  if (name.includes('listRoomVersions')) return { data: versionsData, error: versionsError, refresh: refreshVersions }
  if (name.includes('getRoomVersion')) return { data: ref(null), error: ref(null), refresh: vi.fn() }
  return { data: roomData, error: roomError, refresh: refreshRoom }
})
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn(), isLoading: ref(false) }))
mockNuxtImport('useTasks', () => () => ({ tasks: ref([]), activeCount: ref(0), cancel: vi.fn(), dismiss: vi.fn(), retry: vi.fn() }))

const shellPath = ['~', 'components', 'flashcards', 'RoomShell.vue'].join('/')
const panelPath = ['~', 'components', 'flashcards', 'RoomHistoryPanel.vue'].join('/')

async function mountShell() {
  const Comp = await import(shellPath)
  const wrapper = await mountSuspended(Comp.default, { props: { roomId: 'room_1', folderId: 'folder_abc' } })
  await flushPromises()
  return wrapper
}

describe('RoomShell teaching read failures', () => {
  beforeEach(() => {
    roomData.value = null
    roomError.value = null
    refreshRoom.mockClear()
  })

  it('pauses while a check is open, with no retry', async () => {
    roomError.value = denied('test_open')
    const wrapper = await mountShell()
    const paused = wrapper.get('[data-testid="flashcards-read-paused"]')
    expect(paused.text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
    expect(paused.attributes('role')).toBe('status')
    expect(wrapper.find('[data-testid="flashcards-read-retry"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="flashcards-read-error"]').exists()).toBe(false)
  })

  it('says the content is unavailable when disclosure is unknown', async () => {
    roomError.value = denied('disclosure_unknown')
    const wrapper = await mountShell()
    expect(wrapper.get('[data-testid="flashcards-read-paused"]').text()).toBe('This isn’t available right now.')
    expect(wrapper.find('[data-testid="flashcards-read-retry"]').exists()).toBe(false)
  })

  it('retries a failed read and recovers to the cards', async () => {
    roomError.value = new Error('Network down')
    const wrapper = await mountShell()
    expect(wrapper.get('[data-testid="flashcards-read-error"]').text()).toContain('Could not load these flashcards.')
    await wrapper.get('[data-testid="flashcards-read-retry"]').trigger('click')
    await flushPromises()
    expect(refreshRoom).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="flashcards-read-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="flashcard-room-title"]').text()).toBe('Cell Biology')
  })

  it('treats an unavailable denial as a retryable failure', async () => {
    roomError.value = denied('unavailable')
    const wrapper = await mountShell()
    expect(wrapper.find('[data-testid="flashcards-read-retry"]').exists()).toBe(true)
  })
})

describe('RoomHistoryPanel teaching read failures', () => {
  beforeEach(() => {
    versionsData.value = null
    versionsError.value = null
    roomData.value = null
    roomError.value = null
    refreshVersions.mockClear()
    document.body.innerHTML = ''
  })

  it('shows a retryable error instead of the empty history, then recovers', async () => {
    versionsError.value = new Error('Network down')
    const Comp = await import(panelPath)
    await mountSuspended(Comp.default, { props: { open: true, roomId: 'room_1' } })
    await flushPromises()
    expect(document.querySelector('[data-testid="flashcard-room-history-empty"]')).toBeNull()
    expect(document.querySelector('[data-testid="flashcard-history-read-error"]')?.textContent).toContain('Could not load version history.')
    ;(document.querySelector('[data-testid="flashcard-history-read-retry"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(refreshVersions).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-testid="flashcard-history-read-error"]')).toBeNull()
    expect(document.querySelector('[data-testid="flashcard-room-history-empty"]')).not.toBeNull()
  })
})
