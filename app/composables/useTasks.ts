import { api } from '#convex/api'
import type { Id, Doc } from '../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

export type TaskDoc = Doc<'tasks'>

export function useTasks(folderId: Ref<Id<'folders'>> | Id<'folders'>) {
  const id = isRef(folderId) ? folderId : ref(folderId)
  const nuxtApp = import.meta.client ? useNuxtApp() : null
  const convexAuthReady = import.meta.client
    ? ((nuxtApp!.$convexAuthReady as Ref<boolean> | undefined) ?? ref(false))
    : ref(true)
  const convexAuthenticated = import.meta.client
    ? ((nuxtApp!.$convexAuthenticated as Ref<boolean> | undefined) ?? ref(false))
    : ref(true)
  const convexAuthUsable = computed(
    () => convexAuthReady.value && convexAuthenticated.value,
  )

  const { data: tasksData } = useConvexQuery(
    api.tasks.listByFolder,
    computed(() => ({ folderId: id.value })),
    { enabled: convexAuthUsable },
  )

  const tasks = computed<TaskDoc[]>(
    () => (tasksData.value as TaskDoc[] | undefined) ?? [],
  )

  const activeCount = computed(
    () => tasks.value.filter((t) => t.status === 'pending' || t.status === 'running').length,
  )

  const cancelMutation = import.meta.client
    ? useConvexMutation(api.tasks.cancel)
    : createSsrMutationStub<typeof api.tasks.cancel>()

  const dismissMutation = import.meta.client
    ? useConvexMutation(api.tasks.dismiss)
    : createSsrMutationStub<typeof api.tasks.dismiss>()

  const retryMutation = import.meta.client
    ? useConvexMutation(api.tasks.retry)
    : createSsrMutationStub<typeof api.tasks.retry>()

  async function cancel(taskId: Id<'tasks'>) {
    await cancelMutation.mutate({ taskId })
  }

  async function dismiss(taskId: Id<'tasks'>) {
    await dismissMutation.mutate({ taskId })
  }

  async function retry(taskId: Id<'tasks'>): Promise<Id<'tasks'>> {
    const result = await retryMutation.mutate({ taskId })
    if (!result) throw new Error('Task retry returned no task')
    return result.taskId
  }

  return {
    tasks,
    activeCount,
    cancel,
    dismiss,
    retry,
  }
}
