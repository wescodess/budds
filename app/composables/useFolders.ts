import { until } from '@vueuse/core'
import { api } from '#convex/api'
import type { Doc } from '../../convex/_generated/dataModel'

export async function useFolders() {
  const mutation = import.meta.client
    ? useConvexMutation(api.folders.createFolder)
    : { mutate: async (_args: { name: string }) => {}, isLoading: ref(false) }

  const { data, pending: isLoading } = await useConvexQuery(api.folders.listTopLevelFolders, {})

  const convexAuthReady = import.meta.client
    ? useNuxtApp().$convexAuthReady as Ref<boolean>
    : ref(true)

  async function createFolder(name: string) {
    await until(convexAuthReady).toBe(true, { timeout: 5000 })
    await mutation.mutate({ name })
  }

  return {
    folders: data as Ref<Doc<'folders'>[] | null>,
    isLoading,
    createFolder,
    isCreating: mutation.isLoading,
  }
}
