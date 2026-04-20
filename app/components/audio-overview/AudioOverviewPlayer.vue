<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Pause, Play, Rewind, FastForward, Download, Share2, RefreshCw, History, Check, Trash2, Settings2, Mic, Loader2 } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id, Doc } from '../../../convex/_generated/dataModel'
import type { AudioOverviewTurn } from '~/composables/useAudioOverviewStore'

type OverviewSummary = {
  _id: Id<'audioOverviews'>
  _creationTime: number
  title: string
  status: string
  turnCount: number
  totalDurationMs: number
}

const props = withDefaults(defineProps<{
  overviewId: Id<'audioOverviews'>
  folderId: Id<'folders'>
  overviews?: OverviewSummary[]
  regenerating?: boolean
  interjectionInFlight?: boolean
  interjectionQuestion?: string | null
}>(), {
  overviews: () => [],
  interjectionInFlight: false,
  interjectionQuestion: null,
})

const emit = defineEmits<{
  'request-regenerate': []
  'request-customize': []
  'request-share': []
  'request-ask': []
  'select-overview': [id: Id<'audioOverviews'>]
  'delete-overview': [id: Id<'audioOverviews'>]
}>()

const { data: overviewData } = useConvexQuery(
  api.audioOverviews.getWithTurns,
  computed(() => ({ id: props.overviewId })),
)
const { data: turnUrlData } = useConvexQuery(
  api.audioOverviews.getTurnUrls,
  computed(() => ({ id: props.overviewId })),
)

const overview = computed<Doc<'audioOverviews'> | null>(() => (overviewData.value as Doc<'audioOverviews'> | null | undefined) ?? null)
const turns = computed<AudioOverviewTurn[]>(() => (overview.value?.turns ?? []) as AudioOverviewTurn[])
const turnUrls = computed<(string | null)[]>(() => (turnUrlData.value as (string | null)[] | null | undefined) ?? [])

const folderRef = computed(() => props.folderId)
const { documents } = useDocuments(folderRef)

const store = useAudioOverviewStore()
const {
  currentTurnIndex, isPlaying, playbackRate, currentTimeMs, totalDurationMs, activeTurn,
  magnitude: visualizerMagnitude,
  play, pause, togglePlay, skip, seek, setSpeed, loadOverview,
} = store

watch(
  [() => turns.value, () => turnUrls.value],
  ([nextTurns, nextUrls]) => {
    if (!import.meta.client) return
    if (!overview.value) return
    if (nextTurns.length === 0) return
    if (nextTurns.length !== nextUrls.length) return
    loadOverview({
      overviewId: props.overviewId,
      folderId: props.folderId,
      title: overview.value.title,
      turns: nextTurns,
      turnUrls: nextUrls,
    })
  },
  { immediate: true, deep: true },
)

const speedOptions = [1, 1.2, 1.5, 2] as const
type SpeedOption = typeof speedOptions[number]
const speedMenuOpen = ref(false)

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const totalLabel = computed(() => formatMs(totalDurationMs.value))
const currentLabel = computed(() => formatMs(currentTimeMs.value))

const progressPercent = computed(() => {
  if (totalDurationMs.value <= 0) return 0
  return Math.max(0, Math.min(100, (currentTimeMs.value / totalDurationMs.value) * 100))
})

function handleScrubInput(event: Event) {
  const target = event.target as HTMLInputElement
  const ratio = Number(target.value) / 1000
  const abs = Math.round(ratio * totalDurationMs.value)
  seek(abs)
}

function toggleSpeedMenu() { speedMenuOpen.value = !speedMenuOpen.value }
function pickSpeed(speed: SpeedOption) {
  setSpeed(speed)
  speedMenuOpen.value = false
}

const activeSpeakerLabel = computed(() => {
  const turn = activeTurn.value
  if (!turn) return ''
  return turn.speaker === 'host_a' ? 'Host A · Expert' : 'Host B · Learner'
})

const activeQuote = computed(() => activeTurn.value?.text ?? '')
const activeAttribution = computed(() => {
  const turn = activeTurn.value
  if (!turn) return ''
  const speaker = turn.speaker === 'host_a' ? 'Host A' : 'Host B'
  return `— ${speaker} · ${currentLabel.value}`
})

const sourceFilenames = computed<string[]>(() => {
  const docIds = overview.value?.sourceDocumentIds ?? []
  if (docIds.length === 0) return []
  const byId = new Map<string, string>()
  for (const doc of documents.value ?? []) {
    byId.set(String(doc._id), doc.filename)
  }
  return docIds.map((id, i) => byId.get(String(id)) ?? `Source ${i + 1}`)
})

const hasMissingTurnUrl = computed(() => {
  if (turns.value.length === 0) return false
  return turnUrls.value.some(url => url === null)
})

const historyOpen = ref(false)
const deleteTargetId = ref<Id<'audioOverviews'> | null>(null)
const deleteTargetTitle = ref<string>('')
const downloading = ref(false)

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function handlePickOverview(id: Id<'audioOverviews'>) {
  historyOpen.value = false
  if (id !== props.overviewId) emit('select-overview', id)
}

function openDeleteConfirm(item: OverviewSummary, event: Event) {
  event.stopPropagation()
  deleteTargetId.value = item._id
  deleteTargetTitle.value = item.title
}

function confirmDelete() {
  const id = deleteTargetId.value
  if (!id) return
  emit('delete-overview', id)
  deleteTargetId.value = null
  deleteTargetTitle.value = ''
  historyOpen.value = false
}

function cancelDelete() {
  deleteTargetId.value = null
  deleteTargetTitle.value = ''
}

async function handleDownload() {
  if (downloading.value) return
  downloading.value = true
  try {
    const { downloadOverview } = useAudioOverviewDownload()
    const result = await downloadOverview({
      title: overview.value?.title ?? 'audio-overview',
      turnUrls: turnUrls.value,
    })
    const { toast } = await import('vue-sonner')
    const issues = result.failed.length + result.skipped
    if (issues > 0) {
      const failedLabel = result.failed.length > 0
        ? ` (failed: ${result.failed.map(f => `#${f.index + 1}`).join(', ')})`
        : ''
      toast.warning(`Downloaded ${result.fetched} of ${result.total} segments — ${result.filename}${failedLabel}`)
    } else {
      toast.success(`Downloaded ${result.filename}`)
    }
  } catch (err: any) {
    const { toast } = await import('vue-sonner')
    toast.error(err?.message ?? 'Download failed')
  } finally {
    downloading.value = false
  }
}

function handleCustomize() {
  emit('request-customize')
}

const smoothMag = ref(0)
let rafId: number | null = null

function smoothLoop() {
  const target = visualizerMagnitude.value
  smoothMag.value += (target - smoothMag.value) * 0.18
  if (Math.abs(smoothMag.value - target) < 0.001) smoothMag.value = target
  rafId = requestAnimationFrame(smoothLoop)
}

onMounted(() => { rafId = requestAnimationFrame(smoothLoop) })
onUnmounted(() => { if (rafId !== null) cancelAnimationFrame(rafId) })

const activeHostGlowStyle = computed(() => ({
  transform: `scale(${1 + smoothMag.value * 0.08})`,
}))

const ringOuterStyle = computed(() => ({
  transform: `scale(${1.3 + smoothMag.value * 0.15})`,
  opacity: `${0.15 + smoothMag.value * 0.2}`,
}))

const ringMiddleStyle = computed(() => ({
  transform: `scale(${1.15 + smoothMag.value * 0.12})`,
  opacity: `${0.35 + smoothMag.value * 0.3}`,
}))
</script>

<template>
  <div data-testid="audio-overview-player" class="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:gap-6 sm:p-6">
    <header class="mx-auto flex w-full max-w-4xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div class="min-w-0">
        <p class="font-inter text-xs text-muted-foreground">
          {{ overview?.title ? 'Audio Overview' : '' }}
        </p>
        <h2 data-testid="audio-overview-title" class="mt-1 font-dm-sans text-xl font-bold text-foreground sm:text-2xl">
          {{ overview?.title ?? 'Audio overview' }}
        </h2>
        <p class="mt-1 font-inter text-xs text-muted-foreground">
          {{ totalLabel }} total · {{ turns.length }} turns
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div v-if="props.overviews.length > 1" class="relative">
          <button
            type="button"
            data-testid="audio-overview-history-btn"
            :aria-expanded="historyOpen"
            class="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 font-inter text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            @click="historyOpen = !historyOpen"
          >
            <History class="h-3.5 w-3.5" />
            History
            <span class="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
              {{ props.overviews.length }}
            </span>
          </button>
          <div
            v-if="historyOpen"
            data-testid="audio-overview-history-menu"
            class="absolute right-0 top-full z-20 mt-2 max-h-[60vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border/60 bg-card p-1 shadow-lg"
          >
            <button
              v-for="item in props.overviews"
              :key="item._id"
              type="button"
              :data-testid="`audio-overview-history-item-${item._id}`"
              class="group flex w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/20"
              :class="item._id === props.overviewId ? 'bg-accent/10' : ''"
              @click="handlePickOverview(item._id)"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <Check
                    v-if="item._id === props.overviewId"
                    class="h-3 w-3 shrink-0 text-primary"
                  />
                  <p class="truncate font-dm-sans text-sm font-medium text-foreground">
                    {{ item.title }}
                  </p>
                </div>
                <p class="mt-0.5 font-inter text-[11px] text-muted-foreground">
                  {{ formatMs(item.totalDurationMs) }} · {{ item.turnCount }} turns · {{ formatRelativeTime(item._creationTime) }}
                </p>
              </div>
              <span
                role="button"
                tabindex="0"
                :data-testid="`audio-overview-history-delete-${item._id}`"
                aria-label="Delete audio overview"
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                @click="openDeleteConfirm(item, $event)"
                @keydown.enter.stop="openDeleteConfirm(item, $event)"
                @keydown.space.stop.prevent="openDeleteConfirm(item, $event)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </span>
            </button>
          </div>
        </div>
        <button
          type="button"
          data-testid="audio-overview-ask-btn"
          aria-label="Ask the hosts a follow-up"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 font-inter text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.interjectionInFlight || props.regenerating"
          @click="emit('request-ask')"
        >
          <Mic class="h-3.5 w-3.5" />
          Ask
        </button>
        <button
          type="button"
          data-testid="audio-overview-customize-btn"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 font-inter text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.regenerating"
          @click="handleCustomize"
        >
          <Settings2 class="h-3.5 w-3.5" />
          Customize
        </button>
        <button
          type="button"
          data-testid="audio-overview-regenerate-btn"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 font-inter text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.regenerating"
          @click="emit('request-regenerate')"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="props.regenerating ? 'animate-spin' : ''" />
          {{ props.regenerating ? 'Starting…' : 'Generate new' }}
        </button>
      </div>
    </header>

    <div
      v-if="props.interjectionInFlight"
      data-testid="audio-overview-interjection-banner"
      class="mx-auto flex w-full max-w-4xl items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2"
    >
      <Mic class="h-3.5 w-3.5 shrink-0 text-primary" />
      <p class="flex-1 truncate font-dm-sans text-[13px] font-medium text-foreground">
        Hosts are answering{{ props.interjectionQuestion ? ` "${props.interjectionQuestion}"` : '…' }}
      </p>
      <Loader2 class="h-4 w-4 shrink-0 animate-spin text-primary" />
    </div>

    <UiAlertDialog :open="deleteTargetId !== null" @update:open="(v) => { if (!v) cancelDelete() }">
      <UiAlertDialogContent>
        <UiAlertDialogHeader>
          <UiAlertDialogTitle>Delete audio overview?</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            Delete "{{ deleteTargetTitle || 'this audio overview' }}"? This permanently removes the recording and its audio files.
          </UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel @click="cancelDelete">Cancel</UiAlertDialogCancel>
          <UiAlertDialogAction
            data-testid="audio-overview-delete-confirm"
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            @click="confirmDelete"
          >
            Delete
          </UiAlertDialogAction>
        </UiAlertDialogFooter>
      </UiAlertDialogContent>
    </UiAlertDialog>

    <section class="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 sm:gap-8">
      <div class="grid w-full grid-cols-2 gap-3 sm:gap-4">
        <div
          class="relative flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors sm:gap-3 sm:p-6"
          :class="activeTurn?.speaker === 'host_a' ? 'border-primary/70 bg-card' : 'border-border/60 bg-card/60 opacity-80'"
          data-testid="audio-overview-host-a"
        >
          <div class="relative flex h-16 w-16 items-center justify-center sm:h-24 sm:w-24">
            <span
              v-if="activeTurn?.speaker === 'host_a'"
              class="pointer-events-none absolute h-16 w-16 rounded-full border border-primary/60 transition-[transform,opacity] sm:h-24 sm:w-24"
              :style="ringOuterStyle"
              aria-hidden="true"
            />
            <span
              v-if="activeTurn?.speaker === 'host_a'"
              class="pointer-events-none absolute h-16 w-16 rounded-full border border-primary/80 transition-[transform,opacity] sm:h-24 sm:w-24"
              :style="ringMiddleStyle"
              aria-hidden="true"
            />
            <span
              class="h-16 w-16 rounded-full bg-primary transition-[transform,box-shadow] sm:h-24 sm:w-24"
              :class="activeTurn?.speaker === 'host_a' ? 'shadow-[0_0_40px_rgba(245,158,11,0.55)]' : ''"
              :style="activeTurn?.speaker === 'host_a' ? activeHostGlowStyle : undefined"
              aria-hidden="true"
            />
          </div>
          <div class="text-center">
            <p class="font-dm-sans text-sm font-medium text-foreground">
              Host A · Expert
            </p>
            <p
              class="mt-0.5 font-inter text-xs"
              :class="activeTurn?.speaker === 'host_a' ? 'text-primary' : 'text-muted-foreground'"
            >
              {{ activeTurn?.speaker === 'host_a' ? 'Speaking' : '—' }}
            </p>
          </div>
        </div>
        <div
          class="relative flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors sm:gap-3 sm:p-6"
          :class="activeTurn?.speaker === 'host_b' ? 'border-primary/70 bg-card' : 'border-border/60 bg-card/60 opacity-80'"
          data-testid="audio-overview-host-b"
        >
          <div class="relative flex h-16 w-16 items-center justify-center sm:h-24 sm:w-24">
            <span
              v-if="activeTurn?.speaker === 'host_b'"
              class="pointer-events-none absolute h-16 w-16 rounded-full border border-accent/60 transition-[transform,opacity] sm:h-24 sm:w-24"
              :style="ringOuterStyle"
              aria-hidden="true"
            />
            <span
              v-if="activeTurn?.speaker === 'host_b'"
              class="pointer-events-none absolute h-16 w-16 rounded-full border border-accent/80 transition-[transform,opacity] sm:h-24 sm:w-24"
              :style="ringMiddleStyle"
              aria-hidden="true"
            />
            <span
              class="h-16 w-16 rounded-full bg-accent transition-[transform,box-shadow] sm:h-24 sm:w-24"
              :class="activeTurn?.speaker === 'host_b' ? 'shadow-[0_0_40px_rgba(252,211,77,0.55)]' : ''"
              :style="activeTurn?.speaker === 'host_b' ? activeHostGlowStyle : undefined"
              aria-hidden="true"
            />
          </div>
          <div class="text-center">
            <p class="font-dm-sans text-sm font-medium text-foreground">
              Host B · Learner
            </p>
            <p
              class="mt-0.5 font-inter text-xs"
              :class="activeTurn?.speaker === 'host_b' ? 'text-primary' : 'text-muted-foreground'"
            >
              {{ activeTurn?.speaker === 'host_b' ? 'Speaking' : '—' }}
            </p>
          </div>
        </div>
      </div>

      <blockquote
        data-testid="audio-overview-active-quote"
        class="max-w-2xl text-center font-dm-sans text-base leading-relaxed text-foreground sm:text-lg"
      >
        <span class="mr-1 text-primary">“</span>{{ activeQuote }}<span class="ml-1 text-primary">”</span>
        <p class="mt-2 font-inter text-xs text-muted-foreground">
          {{ activeAttribution }}
        </p>
      </blockquote>
    </section>

    <div
      v-if="hasMissingTurnUrl"
      data-testid="audio-overview-stale-url-warning"
      class="mx-auto w-full max-w-4xl rounded-lg border border-rose-400/50 bg-rose-950/40 p-3 text-center font-inter text-xs text-rose-200"
    >
      An audio segment couldn't be loaded. Try reloading the page.
    </div>

    <section
      data-testid="audio-overview-player-bar"
      class="mx-auto w-full max-w-4xl rounded-xl border border-border/60 bg-card p-4 sm:p-5"
    >
      <div class="flex items-center gap-3">
        <span class="w-12 font-inter text-xs tabular-nums text-muted-foreground">{{ currentLabel }}</span>
        <input
          type="range"
          min="0"
          max="1000"
          :value="Math.round(progressPercent * 10)"
          data-testid="audio-overview-scrubber"
          class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border/40 accent-primary"
          @input="handleScrubInput"
        />
        <span class="w-12 text-right font-inter text-xs tabular-nums text-muted-foreground">{{ totalLabel }}</span>
      </div>

      <div class="mt-3 grid grid-cols-3 items-center gap-2 sm:mt-4">
        <div />
        <div class="flex items-center justify-center gap-3">
          <button
            type="button"
            data-testid="audio-overview-skip-back"
            aria-label="Skip back 10 seconds"
            class="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent/20"
            @click="skip(-10000)"
          >
            <Rewind class="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="audio-overview-play-btn"
            :aria-label="isPlaying ? 'Pause' : 'Play'"
            class="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-[1.03] sm:h-14 sm:w-14"
            @click="togglePlay"
          >
            <Pause v-if="isPlaying" class="h-5 w-5" />
            <Play v-else class="h-5 w-5" />
          </button>
          <button
            type="button"
            data-testid="audio-overview-skip-forward"
            aria-label="Skip forward 10 seconds"
            class="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent/20"
            @click="skip(10000)"
          >
            <FastForward class="h-4 w-4" />
          </button>
        </div>
        <div />
      </div>

      <div class="mt-2 flex items-center justify-center gap-2 sm:mt-3">
        <div class="relative">
          <button
            type="button"
            data-testid="audio-overview-speed-btn"
            class="inline-flex h-8 items-center gap-1 rounded-full border border-border/60 bg-background px-3 font-inter text-xs font-medium text-foreground transition-colors hover:bg-accent/20"
            @click="toggleSpeedMenu"
          >
            {{ playbackRate }}x
            <span aria-hidden="true" class="text-muted-foreground">▾</span>
          </button>
          <div
            v-if="speedMenuOpen"
            data-testid="audio-overview-speed-menu"
            class="absolute bottom-full left-0 z-10 mb-2 min-w-24 rounded-lg border border-border/60 bg-card p-1 shadow-md"
          >
            <button
              v-for="opt in speedOptions"
              :key="opt"
              type="button"
              class="block w-full rounded-md px-3 py-1.5 text-left font-inter text-xs hover:bg-accent/20"
              :class="opt === playbackRate ? 'text-primary' : 'text-foreground'"
              :data-testid="`audio-overview-speed-${opt}`"
              @click="pickSpeed(opt)"
            >
              {{ opt }}x
            </button>
          </div>
        </div>
        <button
          type="button"
          data-testid="audio-overview-download-btn"
          aria-label="Download audio overview"
          :disabled="downloading || turnUrls.length === 0"
          class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleDownload"
        >
          <Download class="h-3.5 w-3.5" :class="downloading ? 'animate-pulse' : ''" />
        </button>
        <button
          type="button"
          data-testid="audio-overview-share-btn"
          :aria-label="overview?.shareToken ? 'Share link' : 'Share audio overview'"
          class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-accent/20"
          @click="emit('request-share')"
        >
          <Share2 class="h-3.5 w-3.5" />
        </button>
      </div>
    </section>

    <section v-if="sourceFilenames.length > 0" class="mx-auto w-full max-w-3xl">
      <p class="font-inter text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Sources grounding this overview
      </p>
      <div class="mt-2 flex flex-wrap gap-2" data-testid="audio-overview-source-pills">
        <span
          v-for="(label, i) in sourceFilenames"
          :key="i"
          class="rounded-md border border-border/60 bg-card/70 px-2 py-1 font-inter text-xs text-muted-foreground"
        >
          {{ label }}
        </span>
      </div>
    </section>
  </div>
</template>
