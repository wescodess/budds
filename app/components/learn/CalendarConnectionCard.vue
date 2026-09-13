<script setup lang="ts">
import { Calendar, Unplug, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { api } from '~~/convex/_generated/api'
import SessionPreferencesForm from './SessionPreferencesForm.vue'

const route = useRoute()
const router = useRouter()

const connection = useConvexQuery(api.calendarConnections.getByUser, {})

const isDisconnecting = ref(false)
const showConfirmDialog = ref(false)

const isConnected = computed(() => {
  return connection.data.value?.status === 'connected'
})

onMounted(() => {
  const calendarError = route.query.calendar_error
  if (calendarError) {
    const message = Array.isArray(calendarError) ? calendarError[0] : calendarError
    if (message) toast.error(message)
    router.replace({ query: { ...route.query, calendar_error: undefined } })
  }
})

async function handleConnect() {
  window.location.href = '/api/calendar/connect'
}

const cancelBtnRef = ref<HTMLButtonElement | null>(null)

function requestDisconnect() {
  showConfirmDialog.value = true
  nextTick(() => cancelBtnRef.value?.focus())
}

function cancelDisconnect() {
  showConfirmDialog.value = false
}

async function confirmDisconnect() {
  showConfirmDialog.value = false
  isDisconnecting.value = true
  try {
    await globalThis.$fetch('/api/calendar/disconnect', { method: 'POST' })
  } catch (err: any) {
    toast.error(err?.message ?? 'Failed to disconnect calendar')
  } finally {
    isDisconnecting.value = false
  }
}
</script>

<template>
  <div
    class="rounded-lg border border-stone-800 bg-stone-900/50 p-4"
    data-testid="calendar-connection-card"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Calendar class="h-5 w-5 text-stone-400" />
        <div>
          <p class="text-sm font-medium text-stone-200">Google Calendar</p>
          <p v-if="isConnected" class="text-xs text-stone-500">
            Connected · {{ connection.data.value?.timezone }}
          </p>
          <p v-else class="text-xs text-stone-500">
            Schedule learning sessions automatically
          </p>
        </div>
      </div>

      <button
        v-if="isConnected"
        class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors"
        :disabled="isDisconnecting"
        data-testid="calendar-disconnect-btn"
        @click="requestDisconnect"
      >
        <Loader2 v-if="isDisconnecting" class="h-4 w-4 animate-spin" />
        <Unplug v-else class="h-4 w-4" />
        Disconnect
      </button>
      <button
        v-else
        class="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 transition-colors"
        data-testid="calendar-connect-btn"
        @click="handleConnect"
      >
        Connect
      </button>
    </div>

    <SessionPreferencesForm
      v-if="isConnected"
      :preferences="connection.data.value?.preferences ?? null"
    />

    <Teleport to="body">
      <div
        v-if="showConfirmDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        data-testid="disconnect-confirm-overlay"
        @click.self="cancelDisconnect"
        @keydown.escape="cancelDisconnect"
      >
        <div
          class="w-full max-w-sm rounded-lg border border-stone-700 bg-stone-900 p-6 shadow-xl"
          role="alertdialog"
          aria-labelledby="disconnect-title"
          aria-describedby="disconnect-desc"
        >
          <h3 id="disconnect-title" class="text-base font-medium text-stone-200">
            Disconnect Google Calendar?
          </h3>
          <p id="disconnect-desc" class="mt-2 text-sm text-stone-400">
            All scheduled learning events will be removed from your Google Calendar. This cannot be undone.
          </p>
          <div class="mt-4 flex justify-end gap-2">
            <button
              ref="cancelBtnRef"
              class="rounded-md px-3 py-1.5 text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors"
              data-testid="disconnect-cancel-btn"
              @click="cancelDisconnect"
            >
              Cancel
            </button>
            <button
              class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 transition-colors"
              data-testid="disconnect-confirm-btn"
              @click="confirmDisconnect"
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
