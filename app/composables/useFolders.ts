import { api } from '#convex/api'
import type { Doc } from '../../convex/_generated/dataModel'

export async function useFolders() {
  const { data, pending: isLoading } = await useConvexQuery(api.folders.listTopLevelFolders, {})

  const mutation = import.meta.client
    ? useConvexMutation(api.folders.createFolder)
    : { mutate: async (_args: { name: string }) => {}, isLoading: ref(false) }

  async function createFolder(name: string) {
    await mutation.mutate({ name })
  }

  return {
    folders: data as Ref<Doc<'folders'>[] | null>,
    isLoading,
    createFolder,
    isCreating: mutation.isLoading,
  }
}
