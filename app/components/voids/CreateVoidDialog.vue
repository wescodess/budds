<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { MessageSquare, Layers, ListChecks, X } from 'lucide-vue-next'

export type VoidType = 'chat' | 'flashcards' | 'quiz'

type VoidOption = {
  type: VoidType
  title: string
  subtitle: string
  icon: typeof MessageSquare
  ctaLabel: string
}

const props = defineProps<{
  open: boolean
  folderName: string
  submitting?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  create: [type: VoidType]
}>()

const options: VoidOption[] = [
  {
    type: 'chat',
    title: 'Chat',
    subtitle: 'Ask questions about this folder\'s knowledge',
    icon: MessageSquare,
    ctaLabel: 'Create chat void',
  },
  {
    type: 'flashcards',
    title: 'Flash Cards',
    subtitle: 'Study with spaced repetition',
    icon: Layers,
    ctaLabel: 'Create flash cards void',
  },
  {
    type: 'quiz',
    title: 'Quiz',
    subtitle: 'Test your understanding',
    icon: ListChecks,
    ctaLabel: 'Create quiz void',
  },
]

const selected = ref<VoidType | null>(null)

const activeCta = computed(() =>
  selected.value
    ? options.find(o => o.type === selected.value)?.ctaLabel ?? 'Create void'
    : 'Create void',
)

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      selected.value = null
    }
  },
)

function close() {
  if (props.submitting) return
  emit('update:open', false)
}

function submit() {
  if (!selected.value || props.submitting) return
  emit('create', selected.value)
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="(val) => emit('update:open', val)">
    <UiDialogContent
      data-testid="create-void-dialog"
      class="max-w-[min(42rem,calc(100%-1rem))] gap-0 p-4 sm:max-w-[42rem] sm:p-6"
    >
      <UiDialogHeader class="space-y-2 pr-10 sm:pr-8">
        <UiDialogTitle class="font-dm-sans text-xl font-bold leading-tight sm:text-[22px]">
          Create a void in {{ props.folderName }}
        </UiDialogTitle>
        <UiDialogDescription class="max-w-[34rem] font-inter text-sm leading-6 text-muted-foreground">
          Voids are dedicated spaces for chat, flashcards, or quizzes. They inherit
          access to this folder's members and knowledge.
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="mt-5 grid grid-cols-1 gap-3 sm:mt-6 sm:grid-cols-3">
        <button
          v-for="option in options"
          :key="option.type"
          type="button"
          :data-testid="`void-type-${option.type}`"
          :aria-pressed="selected === option.type"
          :class="[
            'group relative flex min-h-24 flex-col items-start justify-between rounded-xl bg-card p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-30',
            selected === option.type
              ? 'border-[1.5px] border-primary'
              : 'border border-border hover:border-primary/40 hover:bg-card/80',
            selected !== null && selected !== option.type ? 'opacity-60' : '',
          ]"
          @click="selected = option.type"
        >
          <span
            v-if="selected === option.type"
            class="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary"
            aria-hidden="true"
          />
          <span class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary overflow-hidden">
            <span class="absolute inset-0 bg-primary opacity-10" />
            <component :is="option.icon" class="relative z-10 h-4.5 w-4.5" />
          </span>
          <div class="w-full min-w-0">
            <p class="font-dm-sans text-sm font-semibold text-foreground sm:text-[15px]">
              {{ option.title }}
            </p>
            <p class="mt-1 font-inter text-[13px] leading-5 text-muted-foreground sm:mt-0.5 sm:text-xs sm:leading-relaxed">
              {{ option.subtitle }}
            </p>
          </div>
        </button>
      </div>

      <UiDialogFooter class="mt-5 flex flex-col-reverse items-stretch gap-2 border-t border-border pt-4 sm:mt-6 sm:flex-row sm:items-center sm:justify-between sm:pt-6">
        <UiButton type="button" variant="ghost" class="w-full sm:w-auto" @click="close">Cancel</UiButton>
        <UiButton
          type="button"
          data-testid="create-void-submit"
          class="w-full sm:w-auto"
          :disabled="!selected || props.submitting"
          @click="submit"
        >
          {{ activeCta }}
        </UiButton>
      </UiDialogFooter>

      <UiDialogClose
        class="absolute right-4 top-4 rounded-md text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Close"
      >
        <X class="h-4 w-4" />
      </UiDialogClose>
    </UiDialogContent>
  </UiDialog>
</template>
