<script setup lang="ts">
import { Clock, Save, Loader2 } from 'lucide-vue-next'
import { api } from '#convex/api'
import { toast } from 'vue-sonner'

interface Preferences {
  morningStart: string
  eveningEnd: string
  sessionMinutes: number
  preferredDays: string[]
}

const props = defineProps<{
  preferences: Preferences | null
}>()

const DAYS = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
]

const SESSION_LENGTHS = [5, 10, 15, 25]

const defaults: Preferences = {
  morningStart: '08:00',
  eveningEnd: '21:00',
  sessionMinutes: 15,
  preferredDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
}

const morningStart = ref(props.preferences?.morningStart ?? defaults.morningStart)
const eveningEnd = ref(props.preferences?.eveningEnd ?? defaults.eveningEnd)
const sessionMinutes = ref(props.preferences?.sessionMinutes ?? defaults.sessionMinutes)
const preferredDays = ref<string[]>([...(props.preferences?.preferredDays ?? defaults.preferredDays)])
const saving = ref(false)

const updateMutation = import.meta.client
  ? useConvexMutation(api.calendarConnections.updatePreferences)
  : { mutate: async () => {} }

watch(() => props.preferences, (val) => {
  if (val) {
    morningStart.value = val.morningStart
    eveningEnd.value = val.eveningEnd
    sessionMinutes.value = val.sessionMinutes
    preferredDays.value = [...val.preferredDays]
  }
})

const isDirty = computed(() => {
  const current = props.preferences ?? defaults
  return morningStart.value !== current.morningStart
    || eveningEnd.value !== current.eveningEnd
    || sessionMinutes.value !== current.sessionMinutes
    || JSON.stringify([...preferredDays.value].sort()) !== JSON.stringify([...current.preferredDays].sort())
})

function toggleDay(day: string) {
  const idx = preferredDays.value.indexOf(day)
  if (idx >= 0) {
    preferredDays.value.splice(idx, 1)
  } else {
    preferredDays.value.push(day)
  }
}

async function savePreferences() {
  if (preferredDays.value.length === 0) {
    toast.error('Select at least one day')
    return
  }
  saving.value = true
  try {
    await updateMutation.mutate({
      morningStart: morningStart.value,
      eveningEnd: eveningEnd.value,
      sessionMinutes: sessionMinutes.value,
      preferredDays: preferredDays.value,
    })
    toast.success('Preferences saved')
  } catch (e: any) {
    toast.error(e?.message ?? 'Failed to save preferences')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mt-4 border-t border-stone-800 pt-4" data-testid="session-preferences-form">
    <div class="flex items-center gap-2 mb-3">
      <Clock class="h-4 w-4 text-stone-400" />
      <p class="text-sm font-medium text-stone-300">Session Preferences</p>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="block text-xs text-stone-400">
        Morning start
        <input
          v-model="morningStart"
          type="time"
          class="mt-1 w-full rounded border border-stone-700 bg-stone-950 px-2.5 py-1.5 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
          data-testid="pref-morning-start"
        />
      </label>
      <label class="block text-xs text-stone-400">
        Evening end
        <input
          v-model="eveningEnd"
          type="time"
          class="mt-1 w-full rounded border border-stone-700 bg-stone-950 px-2.5 py-1.5 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
          data-testid="pref-evening-end"
        />
      </label>
    </div>

    <div class="mt-3">
      <p class="text-xs text-stone-400 mb-1.5">Session length</p>
      <div class="flex gap-2" role="radiogroup" aria-label="Session length">
        <button
          v-for="len in SESSION_LENGTHS"
          :key="len"
          type="button"
          :class="[
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            sessionMinutes === len
              ? 'bg-amber-500 text-stone-950 font-medium'
              : 'border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-500'
          ]"
          :aria-checked="sessionMinutes === len"
          role="radio"
          :data-testid="`pref-session-${len}`"
          @click="sessionMinutes = len"
        >
          {{ len }}m
        </button>
      </div>
    </div>

    <div class="mt-3">
      <p class="text-xs text-stone-400 mb-1.5">Preferred days</p>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Preferred days of week">
        <button
          v-for="day in DAYS"
          :key="day.value"
          type="button"
          :class="[
            'rounded-md px-2.5 py-1 text-xs transition-colors',
            preferredDays.includes(day.value)
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              : 'border border-stone-700 text-stone-500 hover:text-stone-300'
          ]"
          :aria-pressed="preferredDays.includes(day.value)"
          :data-testid="`pref-day-${day.value}`"
          @click="toggleDay(day.value)"
        >
          {{ day.label }}
        </button>
      </div>
    </div>

    <button
      v-if="isDirty"
      type="button"
      class="mt-3 flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
      :disabled="saving || preferredDays.length === 0"
      data-testid="pref-save"
      @click="savePreferences"
    >
      <Loader2 v-if="saving" class="h-3.5 w-3.5 animate-spin" />
      <Save v-else class="h-3.5 w-3.5" />
      Save
    </button>
  </div>
</template>
