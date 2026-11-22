import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const room = teachingRead('flashcardRooms:getRoom')
const versions = teachingRead('flashcardRooms:listRoomVersions')
const roomData = room.data as Ref<any>
const roomError = room.error as Ref<any>
const versionsData = versions.data as Ref<any>
const versionsError = versions.error as Ref<any>
const roomContent = {
  room: { _id: 'room_1', _creationTime: Date.now(), title: 'Cell Biology', userId: 'user_a', folderId: 'folder_abc', updatedAt: Date.now() },
  cards: [{ _id: 'c1', displayOrder: 0, term: 'Mitosis', definition: 'Cell division' }],
}

const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })

mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('useConvexQuery', () => () => ({ data: ref(null), error: ref(null), refresh: vi.fn() }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn(), isLoading: ref(false) }))
mockNuxtImport('useTasks', () => () => ({ tasks: ref([]), activeCount: ref(0), cancel: vi.fn(), dismiss: vi.fn(), retry: vi.fn() }))

const shellPath = ['~', 'components', 'flashcards', 'RoomShell.vue'].join('/')
const panelPath = ['~', 'components', 'flashcards', 'RoomHistoryPanel.vue'].join('/')

async function mountShell() {
  const Comp = await import(shellPath)
  const wrapper = await mountSuspended(Comp.default, { props: { roomId: 'room_1', folderId: 'folder_abc' }, global: { stubs: { Motion: { template: '<div><slot /></div>' }, AnimatePresence: { template: '<div><slot /></div>' } } } })
  await flushPromises()
  return wrapper
}

describe('RoomShell teaching read failures', () => {
  beforeEach(() => {
    resetTeachingReads()
    roomData.value = null
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
    const before = room.subscriptions
    await wrapper.get('[data-testid="flashcards-read-retry"]').trigger('click')
    expect(room.subscriptions).toBe(before + 1)
    roomError.value = null
    roomData.value = roomContent
    await flushPromises()
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
    resetTeachingReads()
    versionsData.value = null
    roomData.value = null
    document.body.innerHTML = ''
  })

  it('shows a retryable error instead of the empty history, then recovers', async () => {
    versionsError.value = new Error('Network down')
    const Comp = await import(panelPath)
    await mountSuspended(Comp.default, { props: { open: true, roomId: 'room_1' } })
    await flushPromises()
    expect(document.querySelector('[data-testid="flashcard-room-history-empty"]')).toBeNull()
    expect(document.querySelector('[data-testid="flashcard-history-read-error"]')?.textContent).toContain('Could not load version history.')
    const before = versions.subscriptions
    ;(document.querySelector('[data-testid="flashcard-history-read-retry"]') as HTMLButtonElement).click()
    expect(versions.subscriptions).toBe(before + 1)
    versionsError.value = null
    versionsData.value = []
    await flushPromises()
    expect(document.querySelector('[data-testid="flashcard-history-read-error"]')).toBeNull()
    expect(document.querySelector('[data-testid="flashcard-room-history-empty"]')).not.toBeNull()
  })

describe('RoomShell denial after cards were shown', () => {
  beforeEach(() => {
    resetTeachingReads()
    roomData.value = roomContent
    document.body.innerHTML = ''
  })

  it('removes the cards, closes history and disables the room actions', async () => {
    const wrapper = await mountShell()
    expect(wrapper.text()).toContain('Mitosis')
    await wrapper.get('[data-testid="flashcard-room-mode-practice"]').trigger('click')
    await flushPromises()

    roomError.value = denied('test_open')
    roomData.value = null
    await flushPromises()
    expect(wrapper.get('[data-testid="flashcards-read-paused"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Mitosis')
    expect(wrapper.text()).not.toContain('Cell division')
    for (const id of ['flashcard-room-mode-editor', 'flashcard-room-mode-practice', 'flashcard-room-history-toggle', 'flashcard-room-generate-trigger']) {
      expect(wrapper.get(`[data-testid="${id}"]`).attributes('disabled')).toBeDefined()
    }
  })
})
})
