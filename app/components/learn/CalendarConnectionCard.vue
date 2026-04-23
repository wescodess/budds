<script setup lang="ts">
import { Calendar, Unplug, Loader2 } from 'lucide-vue-next'
import { api } from '~~/convex/_generated/api'

const connection = useConvexQuery(api.calendarConnections.getByUser, {})
const disconnectMutation = useConvexMutation(api.calendarConnections.disconnect)

const isDisconnecting = ref(false)

const isConnected = computed(() => {
  return connection.data.value?.status === 'connected'
})

async function handleConnect() {
  window.location.href = '/api/calendar/connect'
}

async function handleDisconnect() {
  isDisconnecting.value = true
  try {
    await disconnectMutation.mutate({})
  } catch (err) {
    console.error('Failed to disconnect calendar:', err)
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
        @click="handleDisconnect"
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
  </div>
</template>
