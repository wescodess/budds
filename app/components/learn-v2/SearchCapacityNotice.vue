<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Id } from '~~/convex/_generated/dataModel'
import { api } from '#convex/api'

type QuotaRow = {
  scope: 'product_month' | 'product_day' | 'user_day' | 'learning_void_broad'
  available: number
  resetAt: number | null
}

const { learningVoidId } = defineProps<{ learningVoidId: Id<'learningVoids'> }>()
const quota = import.meta.client
  ? useConvexQuery(api.learnV2Search.quotaStatus, { learningVoidId })
  : { data: ref<QuotaRow[] | null>(null) }
const exhausted = computed(() => Array.isArray(quota.data?.value)
  ? (quota.data.value as QuotaRow[]).filter(row => row.available <= 0)
  : [])
const resetAt = computed(() => exhausted.value
  .map(row => row.resetAt)
  .filter((value): value is number => value !== null)
  .sort((a, b) => a - b)[0] ?? null)
const resetLabel = computed(() => resetAt.value === null
  ? null
  : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(resetAt.value))
</script>

<template>
  <aside v-if="exhausted.length" data-testid="learn-v2-search-exhausted" role="status" class="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-stone-200 forced-colors:border-current">
    <p>Free live-web search capacity is used up for this period. Your folder and open research databases are still available. Add a source link, continue with available evidence, or try again after the displayed reset time. No paid search was used.</p>
    <p v-if="resetLabel" class="mt-2 font-medium">Next UTC reset: {{ resetLabel }}</p>
    <p v-else class="mt-2 font-medium">This Learning Void’s broad-search allocation does not reset. Add a source link or continue with available evidence.</p>
  </aside>
</template>
