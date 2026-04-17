import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'

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

  const ssrStub = {
    mutate: async () => { throw new Error('Flashcard room mutations are client-only') },
    isLoading: ref(false),
  } as { mutate: (_args: unknown) => Promise<any>; isLoading: Ref<boolean> }

  const createRoomMutation = import.meta.client
    ? useConvexMutation(api.flashcardRooms.createRoom)
    : ssrStub

  const deleteRoomMutation = import.meta.client
    ? useConvexMutation(api.flashcardRooms.deleteRoom)
    : ssrStub

  const renameRoomMutation = import.meta.client
    ? useConvexMutation(api.flashcardRooms.renameRoom)
    : ssrStub

  async function createRoom(title?: string): Promise<Id<'flashcardRooms'>> {
    const result = await createRoomMutation.mutate({
      folderId: id.value,
      title,
    } as any) as { roomId: Id<'flashcardRooms'> } | null
    return (result?.roomId ?? '') as Id<'flashcardRooms'>
  }

  async function deleteRoom(roomId: Id<'flashcardRooms'>) {
    await deleteRoomMutation.mutate({ roomId } as any)
  }

  async function renameRoom(roomId: Id<'flashcardRooms'>, title: string) {
    await renameRoomMutation.mutate({ roomId, title } as any)
  }

  return {
    rooms,
    hasIndexedDocuments,
    createRoom,
    deleteRoom,
    renameRoom,
  }
}
