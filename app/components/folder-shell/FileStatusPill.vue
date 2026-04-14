<script setup lang="ts">
import { AlertCircle, Loader2, CheckCircle2 } from 'lucide-vue-next'

defineOptions({ name: 'FileStatusPill' })

type Status = 'processing' | 'indexing' | 'success' | 'failed' | 'pending'

const props = defineProps<{
  status: Status
  failureReason?: string
}>()

const meta = computed(() => {
  switch (props.status) {
    case 'success':
      return { label: 'Indexed', icon: CheckCircle2, dotClass: 'bg-emerald-400', wrap: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' }
    case 'processing':
    case 'indexing':
      return { label: 'Processing', icon: Loader2, dotClass: 'bg-amber-400 animate-pulse', wrap: 'text-amber-300 bg-amber-500/10 border-amber-500/20', spin: true }
    case 'pending':
      return { label: 'Queued', icon: Loader2, dotClass: 'bg-muted-foreground', wrap: 'text-muted-foreground bg-muted/50 border-border' }
    case 'failed':
    default:
      return { label: 'Failed', icon: AlertCircle, dotClass: 'bg-destructive', wrap: 'text-destructive bg-destructive/10 border-destructive/20' }
  }
})
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
      meta.wrap,
    ]"
    :title="status === 'failed' ? failureReason : undefined"
    :data-status="status"
  >
    <span :class="['h-1.5 w-1.5 rounded-full', meta.dotClass]" />
    {{ meta.label }}
  </span>
</template>
