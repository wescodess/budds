<script setup lang="ts">
import { AlertTriangle, Sparkles, X } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  open: boolean
  roomId: Id<'flashcardRooms'>
  folderId: Id<'folders'>
  hasExistingCards: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  generated: [result: { versionId: Id<'flashcardRoomVersions'>; cardCount: number }]
}>()

const { generate, generating, lastError } = useFlashcardRooms(toRef(props, 'folderId'))

const prompt = ref('')
const cardCount = ref<number>(12)
const formError = ref<string | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      prompt.value = ''
      cardCount.value = 12
      formError.value = null
    }
  },
)

const clampedCount = computed(() => {
  const n = Number(cardCount.value)
  if (Number.isNaN(n)) return 12
  return Math.min(16, Math.max(6, Math.round(n)))
})

async function handleSubmit() {
  formError.value = null
  if (cardCount.value < 6 || cardCount.value > 16) {
    formError.value = 'Card count must be between 6 and 16'
    return
  }
  try {
    const result = await generate(props.roomId, {
      prompt: prompt.value.trim() || undefined,
      cardCount: clampedCount.value,
    })
    const { toast } = await import('vue-sonner')
    toast.success(`Generated ${result.cardCount} cards`)
    emit('generated', result)
    emit('update:open', false)
  }
  catch (e: any) {
    const msg = e?.message || 'Generation failed'
    if (msg === 'Generation already in progress') {
      const { toast } = await import('vue-sonner')
      toast.warning(msg)
      return
    }
    formError.value = lastError.value || msg
  }
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="(v) => emit('update:open', v)">
    <UiDialogContent
      data-testid="flashcard-room-generate-dialog"
      class="max-w-[min(34rem,calc(100%-1rem))] gap-0 p-4 sm:max-w-[34rem] sm:p-6"
    >
      <UiDialogHeader class="space-y-2">
        <UiDialogTitle class="flex items-center gap-2 font-dm-sans text-xl font-semibold">
          <Sparkles class="h-5 w-5 text-primary" />
          Generate flash cards
        </UiDialogTitle>
        <UiDialogDescription class="font-inter text-sm text-muted-foreground">
          Budds will build a deck from this folder's indexed knowledge. Your current cards will be archived to history first.
        </UiDialogDescription>
      </UiDialogHeader>

      <div
        v-if="hasExistingCards"
        data-testid="flashcard-room-generate-archive-warning"
        class="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
      >
        <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p class="text-foreground/90">
          Your current cards will be archived to a new history version before the new deck is installed.
        </p>
      </div>

      <div class="mt-5 space-y-4">
        <div>
          <UiLabel class="text-xs font-medium">Prompt (optional)</UiLabel>
          <textarea
            v-model="prompt"
            rows="3"
            data-testid="flashcard-room-generate-prompt"
            placeholder="e.g. focus on the photosynthesis chapter"
            class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div>
          <UiLabel class="text-xs font-medium">Card count</UiLabel>
          <input
            v-model.number="cardCount"
            type="number"
            min="6"
            max="16"
            data-testid="flashcard-room-generate-count"
            class="mt-1 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p class="mt-1 text-xs text-muted-foreground">6–16 cards.</p>
        </div>

        <div
          v-if="formError"
          data-testid="flashcard-room-generate-error"
          class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {{ formError }}
        </div>
      </div>

      <UiDialogFooter class="mt-6 flex flex-col-reverse items-stretch gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
        <UiButton
          type="button"
          variant="ghost"
          class="w-full sm:w-auto"
          :disabled="generating"
          @click="emit('update:open', false)"
        >
          Cancel
        </UiButton>
        <UiButton
          type="button"
          data-testid="flashcard-room-generate-submit"
          class="w-full sm:w-auto"
          :disabled="generating"
          @click="handleSubmit"
        >
          <Sparkles class="mr-1.5 h-4 w-4" />
          {{ generating ? 'Generating…' : 'Generate deck' }}
        </UiButton>
      </UiDialogFooter>

      <UiDialogClose
        class="absolute right-4 top-4 rounded-md text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
        aria-label="Close"
      >
        <X class="h-4 w-4" />
      </UiDialogClose>
    </UiDialogContent>
  </UiDialog>
</template>
