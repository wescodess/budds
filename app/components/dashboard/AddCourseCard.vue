<script setup lang="ts">
import { Plus } from 'lucide-vue-next'

const props = defineProps<{
  createFolder: (name: string) => Promise<void>
  isCreating: boolean
  inline?: boolean
}>()

const isActive = ref(false)
const folderName = ref('')
const inputRef = ref<InstanceType<typeof import('@/components/ui/input/Input.vue').default> | null>(null)

function activate() {
  isActive.value = true
  nextTick(() => {
    const el = inputRef.value?.$el as HTMLInputElement | undefined
    el?.focus()
  })
}

function cancel() {
  isActive.value = false
  folderName.value = ''
}

async function submit() {
  if (props.isCreating) return
  const name = folderName.value.trim()
  if (!name) return
  await props.createFolder(name)
  folderName.value = ''
  isActive.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') cancel()
}
</script>

<template>
  <div v-if="inline || isActive" :class="inline ? '' : 'h-[140px]'">
    <UiCard v-if="!inline" class="flex h-full items-center justify-center border border-dashed border-border bg-card p-4">
      <form class="flex w-full gap-2" @submit.prevent="submit">
        <UiInput
          ref="inputRef"
          v-model="folderName"
          data-testid="new-folder-input"
          placeholder="Folder name"
          :disabled="isCreating"
          @keydown="onKeydown"
        />
        <UiButton type="submit" size="sm" data-testid="create-folder-btn" :disabled="!folderName.trim() || isCreating">
          Create
        </UiButton>
      </form>
    </UiCard>

    <form v-else class="flex gap-2" @submit.prevent="submit">
      <UiInput
        ref="inputRef"
        v-model="folderName"
        data-testid="new-folder-input"
        placeholder="Folder name"
        :disabled="isCreating"
        autofocus
        @keydown="onKeydown"
      />
      <UiButton type="submit" size="sm" data-testid="create-folder-btn" :disabled="!folderName.trim() || isCreating">
        Create
      </UiButton>
    </form>
  </div>

  <div v-else class="h-[140px] cursor-pointer" data-testid="add-course-card" @click="activate">
    <UiCard class="flex h-full items-center justify-center border border-dashed border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div class="text-center text-muted-foreground">
        <Plus class="mx-auto mb-2 h-6 w-6" />
        <p class="text-sm font-medium">Add Course</p>
      </div>
    </UiCard>
  </div>
</template>
