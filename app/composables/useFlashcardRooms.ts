import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

export interface FlashcardRoomSummary {
  _id: Id<'flashcardRooms'>
  _creationTime: number
  title: string
  cardCount: number
  updatedAt: number
  legacyCreatedAt?: number
}

export function useFlashcardRooms(folderId: Ref<Id<'folders'>> | Id<'folders'>) {
  const id = isRef(folderId) ? folderId : ref(folderId)

  const { documents } = useDocuments(id)
  const hasIndexedDocuments = computed(() =>
    documents.value?.some((d) => d.status === 'success') ?? false,
  )

  const { data: roomsData } = useConvexQuery(
    api.flashcardRooms.listRoomsByFolder,
    computed(() => ({ folderId: id.value })),
  )

  const rooms = computed<FlashcardRoomSummary[]>(
    () => (roomsData.value as FlashcardRoomSummary[] | undefined) ?? [],
  )

  const createRoomMutation = import.meta.client
    ? useConvexMutation(api.flashcardRooms.createRoom)
    : createSsrMutationStub<typeof api.flashcardRooms.createRoom>()

  const deleteRoomMutation = import.meta.client
    ? useConvexMutation(api.flashcardRooms.deleteRoom)
    : createSsrMutationStub<typeof api.flashcardRooms.deleteRoom>()

  const renameRoomMutation = import.meta.client
    ? useConvexMutation(api.flashcardRooms.renameRoom)
    : createSsrMutationStub<typeof api.flashcardRooms.renameRoom>()

  async function createRoom(title?: string): Promise<Id<'flashcardRooms'>> {
    const result = await createRoomMutation.mutate({
      folderId: id.value,
      title,
    })
    return (result?.roomId ?? '') as Id<'flashcardRooms'>
  }

  async function deleteRoom(roomId: Id<'flashcardRooms'>) {
    await deleteRoomMutation.mutate({ roomId })
  }

  async function renameRoom(roomId: Id<'flashcardRooms'>, title: string) {
    await renameRoomMutation.mutate({ roomId, title })
  }

  return {
    rooms,
    hasIndexedDocuments,
    createRoom,
    deleteRoom,
    renameRoom,
  }
}
