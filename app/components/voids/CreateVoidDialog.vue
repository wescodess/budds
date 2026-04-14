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
      class="max-w-140 gap-0 p-6 sm:max-w-140"
    >
      <UiDialogHeader class="space-y-2 pr-8">
        <UiDialogTitle class="font-dm-sans text-[22px] font-bold leading-tight">
          Create a void in {{ props.folderName }}
        </UiDialogTitle>
        <UiDialogDescription class="font-inter text-sm leading-relaxed text-muted-foreground">
          Voids are dedicated spaces for chat, flashcards, or quizzes. They inherit
          access to this folder's members and knowledge.
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="mt-6 grid grid-cols-3 gap-3">
        <button
          v-for="option in options"
          :key="option.type"
          type="button"
          :data-testid="`void-type-${option.type}`"
          :aria-pressed="selected === option.type"
          :class="[
            'group relative flex h-30 flex-col items-start justify-between rounded-xl bg-card p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <component :is="option.icon" class="h-4.5 w-4.5" />
          </span>
          <div class="w-full">
            <p class="font-dm-sans text-sm font-semibold text-foreground">
              {{ option.title }}
            </p>
            <p class="mt-0.5 font-inter text-xs text-muted-foreground">
              {{ option.subtitle }}
            </p>
          </div>
        </button>
      </div>

      <UiDialogFooter class="mt-6 flex flex-row items-center justify-between gap-2 border-t border-border pt-6 sm:justify-between">
        <UiButton type="button" variant="ghost" @click="close">Cancel</UiButton>
        <UiButton
          type="button"
          data-testid="create-void-submit"
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
