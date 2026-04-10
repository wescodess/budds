import { until } from '@vueuse/core'
import { api } from '#convex/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'

export function useFolders() {
  const createFolderMutation = import.meta.client
    ? useConvexMutation(api.folders.createFolder)
    : { mutate: async (_args: { name: string }) => {}, isLoading: ref(false) }

  const createSubfolderMutation = import.meta.client
    ? useConvexMutation(api.folders.createSubfolder)
    : { mutate: async (_args: { name: string; parentId: Id<'folders'> }) => {}, isLoading: ref(false) }

  const { data: topLevelData, pending: isLoading } = useConvexQuery(api.folders.listTopLevelFolders, {})
  const { data: allFoldersData } = useConvexQuery(api.folders.listAllFolders, {})

  const convexAuthReady = import.meta.client
    ? useNuxtApp().$convexAuthReady as Ref<boolean>
    : ref(true)

  async function createFolder(name: string) {
    await until(convexAuthReady).toBe(true, { timeout: 5000 })
    await createFolderMutation.mutate({ name })
    if (createFolderMutation.error.value) {
      throw createFolderMutation.error.value
    }
  }

  async function createSubfolder(name: string, parentId: Id<'folders'>) {
    await until(convexAuthReady).toBe(true, { timeout: 5000 })
    await createSubfolderMutation.mutate({ name, parentId })
    if (createSubfolderMutation.error.value) {
      throw createSubfolderMutation.error.value
    }
  }

  return {
    folders: topLevelData as Ref<Doc<'folders'>[] | null>,
    allFolders: allFoldersData as Ref<Doc<'folders'>[] | null>,
    isLoading,
    createFolder,
    createSubfolder,
    isCreating: createFolderMutation.isLoading,
  }
}

export function useFolderDetail(folderId: Ref<Id<'folders'>> | Id<'folders'>) {
  const id = isRef(folderId) ? folderId : ref(folderId)

  const { data: folder } = useConvexQuery(
    api.folders.getFolder,
    computed(() => ({ id: id.value })),
  )

  return {
    folder: folder as Ref<Doc<'folders'> | null>,
  }
}
