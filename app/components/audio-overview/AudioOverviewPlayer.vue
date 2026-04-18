<script setup lang="ts">
import { Pause, Play, Rewind, FastForward, Download, Share2, RefreshCw, History, Check, Trash2 } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id, Doc } from '../../../convex/_generated/dataModel'
import { useAudioOverviewPlayer, type OverviewTurn } from '~/composables/useAudioOverviewPlayer'

type OverviewSummary = {
  _id: Id<'audioOverviews'>
  _creationTime: number
  title: string
  status: string
  turnCount: number
  totalDurationMs: number
}

const props = defineProps<{
  overviewId: Id<'audioOverviews'>
  folderId: Id<'folders'>
  overviews: OverviewSummary[]
  regenerating?: boolean
}>()

const emit = defineEmits<{
  'request-regenerate': []
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
const turns = computed<OverviewTurn[]>(() => (overview.value?.turns ?? []) as OverviewTurn[])
const turnUrls = computed<(string | null)[]>(() => (turnUrlData.value as (string | null)[] | null | undefined) ?? [])

const folderRef = computed(() => props.folderId)
const { documents } = useDocuments(folderRef)

const speedOptions = [1, 1.2, 1.5, 2] as const
type SpeedOption = typeof speedOptions[number]
const speedMenuOpen = ref(false)

const {
  attach, currentTurnIndex, isPlaying, playbackRate, currentTimeMs, totalDurationMs, activeTurn,
  play, pause, skip, seek, setSpeed,
} = useAudioOverviewPlayer({ turns, turnUrls })

const audioEl = ref<HTMLAudioElement | null>(null)
const preloadEl = ref<HTMLAudioElement | null>(null)

onMounted(() => {
  attach(audioEl.value, preloadEl.value)
})

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

function togglePlay() {
  if (isPlaying.value) pause()
  else void play()
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
</script>

<template>
  <div data-testid="audio-overview-player" class="flex h-full min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
    <header class="mx-auto flex w-full max-w-4xl items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="font-inter text-xs text-muted-foreground">
          {{ overview?.title ? 'Audio Overview' : '' }}
        </p>
        <h2 data-testid="audio-overview-title" class="mt-1 font-dm-sans text-2xl font-bold text-foreground">
          {{ overview?.title ?? 'Audio overview' }}
        </h2>
        <p class="mt-1 font-inter text-xs text-muted-foreground">
          {{ totalLabel }} total · {{ turns.length }} turns
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
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

    <section class="mx-auto flex w-full max-w-3xl flex-col items-center gap-8">
      <div class="grid w-full grid-cols-2 gap-4">
        <div
          class="flex flex-col items-center gap-3 rounded-xl border p-6 transition-colors"
          :class="activeTurn?.speaker === 'host_a' ? 'border-primary/70 bg-card' : 'border-border/60 bg-card/60 opacity-80'"
          data-testid="audio-overview-host-a"
        >
          <span
            class="h-16 w-16 rounded-full bg-primary transition-shadow"
            :class="activeTurn?.speaker === 'host_a' ? 'shadow-[0_0_24px_rgba(245,158,11,0.35)]' : ''"
            aria-hidden="true"
          />
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
          class="flex flex-col items-center gap-3 rounded-xl border p-6 transition-colors"
          :class="activeTurn?.speaker === 'host_b' ? 'border-primary/70 bg-card' : 'border-border/60 bg-card/60 opacity-80'"
          data-testid="audio-overview-host-b"
        >
          <span
            class="h-16 w-16 rounded-full bg-accent transition-shadow"
            :class="activeTurn?.speaker === 'host_b' ? 'shadow-[0_0_24px_rgba(252,211,77,0.35)]' : ''"
            aria-hidden="true"
          />
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
        class="max-w-2xl text-center font-dm-sans text-lg leading-relaxed text-foreground"
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

      <div class="mt-4 flex items-center justify-between">
        <div class="flex items-center">
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
        </div>

        <div class="flex items-center gap-3">
          <button
            type="button"
            data-testid="audio-overview-skip-back"
            aria-label="Skip back 15 seconds"
            class="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent/20"
            @click="skip(-15000)"
          >
            <Rewind class="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="audio-overview-play-btn"
            :aria-label="isPlaying ? 'Pause' : 'Play'"
            class="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-[1.03]"
            @click="togglePlay"
          >
            <Pause v-if="isPlaying" class="h-5 w-5" />
            <Play v-else class="h-5 w-5" />
          </button>
          <button
            type="button"
            data-testid="audio-overview-skip-forward"
            aria-label="Skip forward 15 seconds"
            class="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent/20"
            @click="skip(15000)"
          >
            <FastForward class="h-4 w-4" />
          </button>
        </div>

        <div class="flex items-center gap-1">
          <button
            type="button"
            data-testid="audio-overview-download-btn"
            aria-label="Download (coming soon)"
            class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 font-inter text-xs text-muted-foreground opacity-60"
            disabled
          >
            <Download class="h-3.5 w-3.5" />
            <span class="rounded-sm border border-border/60 px-1 text-[10px] uppercase tracking-wide">Soon</span>
          </button>
          <button
            type="button"
            data-testid="audio-overview-share-btn"
            aria-label="Share (coming soon)"
            class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 font-inter text-xs text-muted-foreground opacity-60"
            disabled
          >
            <Share2 class="h-3.5 w-3.5" />
            <span class="rounded-sm border border-border/60 px-1 text-[10px] uppercase tracking-wide">Soon</span>
          </button>
        </div>
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

    <audio ref="audioEl" preload="metadata" class="hidden" />
    <audio ref="preloadEl" preload="auto" class="hidden" />
  </div>
</template>
