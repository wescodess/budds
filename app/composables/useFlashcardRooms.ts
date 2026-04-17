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

export interface GeneratedCardPayload {
  term: string
  definition: string
  metadata?: {
    source?: {
      documentId?: string
      filename: string
      chunkContent: string
    }
  }
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

  const generateMutation = import.meta.client
    ? useConvexMutation(api.flashcardRooms.generateRoomCards)
    : ssrStub

  const generating = useState<boolean>(`flashcardRooms:generating:${id.value}`, () => false)
  const lastError = useState<string | null>(`flashcardRooms:lastError:${id.value}`, () => null)

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

  async function generate(
    roomId: Id<'flashcardRooms'>,
    options: { prompt?: string; cardCount?: number; model?: string } = {},
  ): Promise<{ versionId: Id<'flashcardRoomVersions'>; cardCount: number }> {
    if (generating.value) throw new Error('Generation already in progress')
    generating.value = true
    lastError.value = null
    try {
      const generated = await $fetch<{
        title: string
        model: string
        cardCount: number
        cards: Array<{
          order: number
          front: string
          back: string
          sourceDocumentId?: string
          sourceChunkContent: string
          sourceFilename: string
        }>
      }>('/api/flashcards/generate', {
        method: 'POST',
        body: {
          folderId: id.value,
          model: options.model,
          cardCount: options.cardCount,
        },
      })

      const payloadCards: GeneratedCardPayload[] = generated.cards.map((c) => ({
        term: c.front,
        definition: c.back,
        metadata: {
          source: {
            documentId: c.sourceDocumentId,
            filename: c.sourceFilename,
            chunkContent: c.sourceChunkContent,
          },
        },
      }))

      const result = (await generateMutation.mutate({
        roomId,
        origin: 'ai',
        prompt: options.prompt,
        requestedCardCount: options.cardCount,
        model: generated.model,
        title: generated.title,
        cards: payloadCards,
      } as any)) as { versionId: Id<'flashcardRoomVersions'>; cardCount: number }

      return {
        versionId: result.versionId,
        cardCount: result.cardCount,
      }
    }
    catch (e: any) {
      const message = e?.data?.message || e?.statusMessage || e?.message || 'Flash card generation failed'
      lastError.value = message
      throw e
    }
    finally {
      generating.value = false
    }
  }

  return {
    rooms,
    hasIndexedDocuments,
    generating,
    lastError,
    createRoom,
    deleteRoom,
    renameRoom,
    generate,
  }
}
