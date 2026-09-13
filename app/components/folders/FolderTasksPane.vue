<script setup lang="ts">
import { toast } from 'vue-sonner'
import { getErrorMessage } from '~~/shared/errors'
import {
  X,
  Sparkles,
  CheckCircle2,
  XCircle,
  Ban,
  RotateCcw,
  Eye,
  Loader2,
  ListTodo,
} from '@lucide/vue'
import type { Id } from '~~/convex/_generated/dataModel'
import type { TaskDoc } from '~/composables/useTasks'
import { useHorizontalSwipeGesture } from '~/composables/useHorizontalSwipeGesture'
import { PANEL_DISMISS_THRESHOLD_PX, useGestureGuards } from '~/composables/useGestureGuards'

const props = withDefaults(defineProps<{
  folderId: Id<'folders'>
  embedded?: boolean
}>(), { embedded: false })

const emit = defineEmits<{
  close: []
  'view-room': [roomId: string]
}>()

const { tasks, activeCount, cancel, dismiss, retry } = useTasks(toRef(props, 'folderId'))

const paneRef = ref<HTMLElement | null>(null)
const { shouldStartHorizontalGesture } = useGestureGuards()
const dismissedIds = ref(new Set<string>())
const autoDismissTimers = new Map<string, ReturnType<typeof setTimeout>>()

watch(tasks, (list) => {
  for (const task of list) {
    if (task.status === 'completed' && !autoDismissTimers.has(String(task._id))) {
      autoDismissTimers.set(
        String(task._id),
        setTimeout(() => {
          dismissedIds.value = new Set([...dismissedIds.value, String(task._id)])
          autoDismissTimers.delete(String(task._id))
        }, 30_000),
      )
    }
  }
}, { deep: true })

onUnmounted(() => {
  for (const timer of autoDismissTimers.values()) clearTimeout(timer)
  autoDismissTimers.clear()
})

const visibleTasks = computed(() =>
  tasks.value.filter((t) => !dismissedIds.value.has(String(t._id))),
)

function interactWithTask(taskId: string) {
  const timer = autoDismissTimers.get(taskId)
  if (timer) {
    clearTimeout(timer)
    autoDismissTimers.delete(taskId)
  }
}

function typeIcon(type: string) {
  if (type === 'flashcard-generation') return Sparkles
  return Sparkles
}

function statusColor(status: string) {
  if (status === 'running' || status === 'pending') return 'text-amber-500'
  if (status === 'completed') return 'text-emerald-400'
  if (status === 'failed') return 'text-rose-400'
  if (status === 'cancelled') return 'text-muted-foreground'
  return 'text-muted-foreground'
}

async function handleCancel(task: TaskDoc) {
  interactWithTask(String(task._id))
  try {
    await cancel(task._id)
  } catch (e) {
    toast.error(getErrorMessage(e, 'Failed to cancel task'))
  }
}

async function handleDismiss(task: TaskDoc) {
  interactWithTask(String(task._id))
  try {
    await dismiss(task._id)
  } catch (e) {
    toast.error(getErrorMessage(e, 'Failed to dismiss task'))
  }
}

async function handleRetry(task: TaskDoc) {
  interactWithTask(String(task._id))
  try {
    await retry(task._id)
    toast.success('Task restarted')
  } catch (e) {
    toast.error(getErrorMessage(e, 'Failed to retry task'))
  }
}

function handleView(task: TaskDoc) {
  interactWithTask(String(task._id))
  const meta = task.metadata as { roomId?: string } | undefined
  const result = task.result as { roomId?: string } | undefined
  const roomId = result?.roomId ?? meta?.roomId
  if (roomId) emit('view-room', roomId)
}

useHorizontalSwipeGesture({
  target: paneRef,
  threshold: 24,
  shouldStart(event) {
    return shouldStartHorizontalGesture(event, {
      allowGestureOwners: true,
      edgeGuardPx: 12,
    })
  },
  onSwipeEnd({ deltaX }) {
    if (deltaX >= PANEL_DISMISS_THRESHOLD_PX) emit('close')
  },
})
</script>

<template>
  <aside
    ref="paneRef"
    data-testid="folder-tasks-pane"
    data-gesture-owner="tasks-panel"
    class="flex h-full flex-col bg-background"
  >
    <div v-if="!props.embedded" class="flex items-center justify-between border-b px-4 py-3">
      <div class="flex items-center gap-2">
        <h3 class="font-semibold tracking-tight">Tasks</h3>
        <span
          v-if="activeCount > 0"
          data-testid="tasks-active-badge"
          class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-medium text-white"
        >
          {{ activeCount }}
        </span>
      </div>
      <button
        type="button"
        data-testid="folder-tasks-close"
        aria-label="Close tasks panel"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
        @click="emit('close')"
      >
        <X class="h-4 w-4" />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      <div
        v-if="visibleTasks.length === 0"
        data-testid="tasks-empty-state"
        class="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground"
      >
        <ListTodo class="h-10 w-10 opacity-40" />
        <p class="text-sm font-medium">No active tasks</p>
        <p class="text-xs">Tasks from flashcard generation will appear here.</p>
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="task in visibleTasks"
          :key="String(task._id)"
          :data-testid="`task-card-${task._id}`"
          class="rounded-lg border border-border/60 bg-card/40 p-3"
          :class="{
            'border-l-2 border-l-amber-500': task.status === 'running' || task.status === 'pending',
            'border-l-2 border-l-emerald-400': task.status === 'completed',
            'border-l-2 border-l-rose-400': task.status === 'failed',
          }"
        >
          <div class="flex items-start gap-3">
            <component
              :is="typeIcon(task.type)"
              class="mt-0.5 h-4 w-4 shrink-0"
              :class="statusColor(task.status)"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ task.title }}</p>
              <div class="mt-1 flex items-center gap-2">
                <Loader2
                  v-if="task.status === 'running' || task.status === 'pending'"
                  class="h-3 w-3 animate-spin text-amber-500"
                />
                <CheckCircle2
                  v-else-if="task.status === 'completed'"
                  class="h-3 w-3 text-emerald-400"
                />
                <XCircle
                  v-else-if="task.status === 'failed'"
                  class="h-3 w-3 text-rose-400"
                />
                <Ban
                  v-else-if="task.status === 'cancelled'"
                  class="h-3 w-3 text-muted-foreground"
                />
                <span class="text-xs text-muted-foreground">
                  {{ task.status === 'failed' ? task.error : task.progress }}
                </span>
              </div>

              <div class="mt-2 flex items-center gap-2">
                <button
                  v-if="task.status === 'running' || task.status === 'pending'"
                  type="button"
                  data-testid="task-cancel-btn"
                  class="text-xs text-muted-foreground hover:text-foreground"
                  @click="handleCancel(task)"
                >
                  Cancel
                </button>
                <button
                  v-if="task.status === 'failed'"
                  type="button"
                  data-testid="task-retry-btn"
                  class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  @click="handleRetry(task)"
                >
                  <RotateCcw class="h-3 w-3" />
                  Retry
                </button>
                <button
                  v-if="task.status === 'completed'"
                  type="button"
                  data-testid="task-view-btn"
                  class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  @click="handleView(task)"
                >
                  <Eye class="h-3 w-3" />
                  View
                </button>
                <button
                  v-if="task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'"
                  type="button"
                  data-testid="task-dismiss-btn"
                  class="text-xs text-muted-foreground hover:text-foreground"
                  @click="handleDismiss(task)"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
