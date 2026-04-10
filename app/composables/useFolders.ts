import { api } from '#convex/api'
import type { Doc } from '../../convex/_generated/dataModel'

export async function useFolders() {
  const { data, pending: isLoading } = await useConvexQuery(api.folders.listTopLevelFolders, {})

  const { mutate, isLoading: isCreating } = useConvexMutation(api.folders.createFolder)

  async function createFolder(name: string) {
    await mutate({ name })
  }

  return {
    folders: data as Ref<Doc<'folders'>[] | null>,
    isLoading,
    createFolder,
    isCreating,
  }
}
