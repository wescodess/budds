<script setup lang="ts">
import { Trash2, Loader2 } from '@lucide/vue'
import type { Id } from '~~/convex/_generated/dataModel'
import { api } from '#convex/api'

const props = defineProps<{
  courseId: Id<'courses'>
  courseTitle: string
}>()

const emit = defineEmits<{
  deleted: []
}>()

const open = ref(false)
const deleting = ref(false)

const deleteMutation = import.meta.client
  ? useConvexAction(api.courses.deleteCourse)
  : { mutate: async (_args: { id: Id<'courses'> }) => null }

async function handleDelete() {
  deleting.value = true
  try {
    const result = await deleteMutation.mutate({ id: props.courseId })
    open.value = false
    const { toast } = await import('vue-sonner')
    toast(result?.pending ? 'Course deletion started' : 'Course deleted')
    emit('deleted')
  } catch {
    const { toast } = await import('vue-sonner')
    toast.error('Failed to delete course')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UiAlertDialog v-model:open="open">
    <UiAlertDialogTrigger as-child>
      <button
        data-testid="delete-course-trigger"
        class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
        @click="open = true"
      >
        <Trash2 class="h-4 w-4" />
        Delete Course
      </button>
    </UiAlertDialogTrigger>
    <UiAlertDialogContent data-testid="delete-course-dialog">
      <UiAlertDialogHeader>
        <UiAlertDialogTitle>Delete Course</UiAlertDialogTitle>
        <UiAlertDialogDescription>
          This will permanently delete "{{ courseTitle }}" and all its sections, quizzes, flashcards, and audio. This action cannot be undone.
        </UiAlertDialogDescription>
      </UiAlertDialogHeader>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel data-testid="delete-course-cancel">
          Cancel
        </UiAlertDialogCancel>
        <UiAlertDialogAction
          data-testid="delete-course-confirm"
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          :disabled="deleting"
          @click.prevent="handleDelete"
        >
          <Loader2 v-if="deleting" class="mr-2 h-4 w-4 animate-spin" />
          Delete
        </UiAlertDialogAction>
      </UiAlertDialogFooter>
    </UiAlertDialogContent>
  </UiAlertDialog>
</template>
