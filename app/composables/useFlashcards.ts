import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'

export interface FlashcardSetSummary {
  _id: Id<'flashcardSets'>
  _creationTime: number
  title: string
  status: 'generating' | 'ready' | 'failed'
  cardCount: number
}

export function useFlashcards(folderId: Ref<Id<'folders'>> | Id<'folders'>) {
  const id = isRef(folderId) ? folderId : ref(folderId)

  const { documents } = useDocuments(id)

  const hasIndexedDocuments = computed(() =>
    documents.value?.some((d) => d.status === 'success') ?? false,
  )

  const { data: setsData } = useConvexQuery(
    api.flashcards.listByFolder,
    computed(() => ({ folderId: id.value })),
  )

  const sets = computed<FlashcardSetSummary[]>(() => (setsData.value as FlashcardSetSummary[] | undefined) ?? [])

  const createSetMutation = import.meta.client
    ? useConvexMutation(api.flashcards.createSetWithCards)
    : {
        mutate: async (_args: unknown): Promise<any> => null,
        isLoading: ref(false),
      }

  const generating = ref(false)
  const lastError = ref<string | null>(null)

  async function generate(options: { model?: string; cardCount?: number } = {}) {
    if (generating.value) return
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
          ...options,
        },
      })

      await createSetMutation.mutate({
        folderId: id.value,
        title: generated.title,
        model: generated.model,
        cards: generated.cards,
      })
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
    sets,
    hasIndexedDocuments,
    generating,
    lastError,
    generate,
  }
}
