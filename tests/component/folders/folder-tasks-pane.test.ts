import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockTasks = ref<any[]>([])
const mockActiveCount = computed(() =>
  mockTasks.value.filter((t: any) => t.status === 'pending' || t.status === 'running').length,
)
const mockCancel = vi.fn()
const mockDismiss = vi.fn()
const mockRetry = vi.fn()

mockNuxtImport('useTasks', () => {
  return () => ({
    tasks: mockTasks,
    activeCount: mockActiveCount,
    cancel: mockCancel,
    dismiss: mockDismiss,
    retry: mockRetry,
  })
})

mockNuxtImport('useGestureGuards', () => {
  return () => ({
    shouldStartHorizontalGesture: () => true,
  })
})

mockNuxtImport('useHorizontalSwipeGesture', () => {
  return () => {}
})

const panePath = ['~', 'components', 'folders', 'FolderTasksPane.vue'].join('/')

describe('FolderTasksPane', () => {
  beforeEach(() => {
    mockTasks.value = []
    mockCancel.mockReset()
    mockDismiss.mockReset()
    mockRetry.mockReset()
    document.body.innerHTML = ''
  })

  it('[P0] shows empty state when no tasks', async () => {
    const Pane = await import(panePath)
    const wrapper = await mountSuspended(Pane.default, {
      props: { folderId: 'folder_1' as any },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="tasks-empty-state"]').exists()).toBe(true)
  })

  it('[P0] renders task cards', async () => {
    mockTasks.value = [
      {
        _id: 'task_1',
        status: 'running',
        type: 'flashcard-generation',
        title: 'Generating 12 cards…',
        progress: 'Generating cards…',
        metadata: { roomId: 'room_1' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]

    const Pane = await import(panePath)
    const wrapper = await mountSuspended(Pane.default, {
      props: { folderId: 'folder_1' as any },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="task-card-task_1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tasks-empty-state"]').exists()).toBe(false)
  })

  it('[P0] shows cancel button for running tasks', async () => {
    mockTasks.value = [
      {
        _id: 'task_1',
        status: 'running',
        type: 'flashcard-generation',
        title: 'Generating',
        progress: 'Generating cards…',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]

    const Pane = await import(panePath)
    const wrapper = await mountSuspended(Pane.default, {
      props: { folderId: 'folder_1' as any },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="task-cancel-btn"]').exists()).toBe(true)
  })

  it('[P0] shows retry and dismiss buttons for failed tasks', async () => {
    mockTasks.value = [
      {
        _id: 'task_2',
        status: 'failed',
        type: 'flashcard-generation',
        title: 'Failed gen',
        error: 'Not enough content',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: Date.now(),
      },
    ]

    const Pane = await import(panePath)
    const wrapper = await mountSuspended(Pane.default, {
      props: { folderId: 'folder_1' as any },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="task-retry-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="task-dismiss-btn"]').exists()).toBe(true)
  })

  it('[P0] shows active count badge', async () => {
    mockTasks.value = [
      {
        _id: 'task_1',
        status: 'running',
        type: 'flashcard-generation',
        title: 'Running',
        progress: 'Working…',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]

    const Pane = await import(panePath)
    const wrapper = await mountSuspended(Pane.default, {
      props: { folderId: 'folder_1' as any },
    })
    await flushPromises()

    const badge = wrapper.find('[data-testid="tasks-active-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('1')
  })
})
