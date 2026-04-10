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

  const renameFolderMutation = import.meta.client
    ? useConvexMutation(api.folders.renameFolder)
    : { mutate: async (_args: { id: Id<'folders'>; name: string }) => {}, isLoading: ref(false) }

  const deleteFolderMutation = import.meta.client
    ? useConvexMutation(api.folders.deleteFolder)
    : { mutate: async (_args: { id: Id<'folders'> }) => {}, isLoading: ref(false) }

  const { data: topLevelData, pending: isLoading } = useConvexQuery(api.folders.listTopLevelFolders, {})
  const { data: allFoldersData, pending: allFoldersLoading } = useConvexQuery(api.folders.listAllFolders, {})

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

  async function renameFolder(id: Id<'folders'>, name: string) {
    await until(convexAuthReady).toBe(true, { timeout: 5000 })
    await renameFolderMutation.mutate({ id, name })
    if (renameFolderMutation.error.value) {
      throw renameFolderMutation.error.value
    }
  }

  async function deleteFolder(id: Id<'folders'>) {
    await until(convexAuthReady).toBe(true, { timeout: 5000 })
    const result = await deleteFolderMutation.mutate({ id })
    if (deleteFolderMutation.error.value) {
      throw deleteFolderMutation.error.value
    }
    return result
  }

  return {
    folders: topLevelData as Ref<Doc<'folders'>[] | null>,
    allFolders: allFoldersData as Ref<Doc<'folders'>[] | null>,
    isLoading,
    allFoldersLoading,
    createFolder,
    createSubfolder,
    renameFolder,
    deleteFolder,
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
