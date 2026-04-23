<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Pause, Play, Rewind, FastForward, Download } from 'lucide-vue-next'
import { api } from '#convex/api'
import { createAudioOverviewPlayback, type AudioOverviewTurn } from '~/composables/useAudioOverviewStore'

const props = defineProps<{
  token: string
}>()

const tokenRef = computed(() => props.token)

const { data: overviewData } = useConvexQuery(
  api.audioOverviews.getByShareToken,
  computed(() => ({ token: tokenRef.value })),
)
const { data: turnUrlData } = useConvexQuery(
  api.audioOverviews.getTurnUrlsByShareToken,
  computed(() => ({ token: tokenRef.value })),
)

type PublicOverview = {
  title: string
  turns: AudioOverviewTurn[]
  voiceProfile: { hostA: string, hostB: string }
  totalDurationMs: number
  sourceDocumentIds: string[]
  sourceFilenames: string[]
  publishedAt: number | null
}

const overview = computed<PublicOverview | null>(() => (overviewData.value as PublicOverview | null | undefined) ?? null)
const turns = computed<AudioOverviewTurn[]>(() => overview.value?.turns ?? [])
const turnUrls = computed<(string | null)[]>(() => (turnUrlData.value as (string | null)[] | null | undefined) ?? [])
const sourceFilenames = computed<string[]>(() => overview.value?.sourceFilenames ?? [])

const playback = createAudioOverviewPlayback()
const {
  currentTimeMs, totalDurationMs, activeTurn, isPlaying, playbackRate,
  magnitude: visualizerMagnitude,
  togglePlay, skip, seek, setSpeed, loadOverview, attachAudio,
} = playback

const audioEl = ref<HTMLAudioElement | null>(null)
const preloadEl = ref<HTMLAudioElement | null>(null)

watch([audioEl, preloadEl], ([el, pre]) => {
  if (el) attachAudio(el, pre)
}, { immediate: true })

const loading = computed(() => overviewData.value === undefined)
const notFound = computed(() => overviewData.value === null)

const PUBLIC_SENTINEL_ID = 'public-playback' as unknown as import('../../../convex/_generated/dataModel').Id<'audioOverviews'>

watch(
  [() => turns.value, () => turnUrls.value, () => overview.value],
  ([nextTurns, nextUrls, ov]) => {
    if (!import.meta.client) return
    if (!ov) return
    if (nextTurns.length === 0) return
    if (nextTurns.length !== nextUrls.length) return
    loadOverview({
      overviewId: PUBLIC_SENTINEL_ID,
      folderId: null,
      title: ov.title,
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

interface DialogueLine {
  speaker: 'host_a' | 'host_b'
  text: string
  alignClass: string
  bubbleClass: string
  speakerLabel: string
}

const dialogueLines = computed<DialogueLine[]>(() => {
  const raw = activeTurn.value?.text ?? ''
  if (!raw.startsWith('Host A:') && !raw.startsWith('Host B:')) return []
  return raw.split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^(Host [AB]):\s*(.*)/)
    if (!match) return null
    const isA = match[1] === 'Host A'
    return {
      speaker: isA ? 'host_a' as const : 'host_b' as const,
      text: match[2]!,
      alignClass: isA ? 'justify-start' : 'justify-end',
      bubbleClass: isA ? 'rounded-tl-sm bg-primary/10 text-foreground' : 'rounded-tr-sm bg-secondary text-foreground',
      speakerLabel: isA ? 'Host A \u00b7 Expert' : 'Host B \u00b7 Learner',
    }
  }).filter((l): l is DialogueLine => l !== null)
})

const isDialogueFormat = computed(() => dialogueLines.value.length > 0)

const activeQuote = computed(() => activeTurn.value?.text ?? '')
const activeAttribution = computed(() => {
  const turn = activeTurn.value
  if (!turn) return ''
  if (isDialogueFormat.value) return ''
  const speaker = turn.speaker === 'host_a' ? 'Host A' : 'Host B'
  return `— ${speaker} · ${currentLabel.value}`
})

const publishedLabel = computed(() => {
  if (!overview.value?.publishedAt) return ''
  const d = new Date(overview.value.publishedAt)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
})

const hasMissingTurnUrl = computed(() => {
  if (turns.value.length === 0) return false
  return turnUrls.value.some(url => url === null)
})

const downloading = ref(false)
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
    }
    else {
      toast.success(`Downloaded ${result.filename}`)
    }
  }
  catch (err: any) {
    const { toast } = await import('vue-sonner')
    toast.error(err?.message ?? 'Download failed')
  }
  finally {
    downloading.value = false
  }
}

const activeHostGlowStyle = computed(() => ({
  transform: `scale(${1 + visualizerMagnitude.value * 0.08})`,
}))

const ringOuterStyle = computed(() => ({
  transform: `scale(${1.3 + visualizerMagnitude.value * 0.15})`,
  opacity: `${0.15 + visualizerMagnitude.value * 0.2}`,
}))

const ringMiddleStyle = computed(() => ({
  transform: `scale(${1.15 + visualizerMagnitude.value * 0.12})`,
  opacity: `${0.35 + visualizerMagnitude.value * 0.3}`,
}))
</script>

<template>
  <div
    v-if="loading"
    data-testid="public-audio-loading"
    class="flex min-h-[60vh] flex-1 items-center justify-center text-muted-foreground"
  >
    <p class="font-inter text-sm">Loading audio overview…</p>
  </div>

  <div
    v-else-if="notFound"
    data-testid="public-audio-not-found"
    class="mx-auto flex min-h-[60vh] w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
  >
    <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
      <svg class="h-5 w-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01" />
      </svg>
    </div>
    <h2 class="font-dm-sans text-xl font-semibold text-foreground">This link is no longer active</h2>
    <p class="font-inter text-sm text-muted-foreground">
      The audio overview may have been unshared or never existed.
    </p>
    <NuxtLink to="/" class="font-inter text-sm font-medium text-primary hover:underline">
      Create your own audio overview in Budds →
    </NuxtLink>
  </div>

  <div
    v-else-if="overview"
    data-testid="public-audio-shell"
    class="flex min-h-[var(--mobile-vh,100dvh)] flex-col gap-6 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6"
  >
    <header class="mx-auto flex w-full max-w-4xl items-center justify-between">
      <NuxtLink
        to="/"
        class="flex items-center gap-2 font-dm-sans text-sm font-bold tracking-tight"
      >
        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </span>
        <span class="hidden sm:inline">Budds · Learning Compiler</span>
        <span class="sm:hidden">Budds</span>
      </NuxtLink>
      <NuxtLink
        to="/"
        data-testid="public-audio-open-in-budds"
        class="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-1.5 font-inter text-xs font-medium text-primary transition-colors hover:bg-primary/10"
      >
        Open in Budds
      </NuxtLink>
    </header>

    <div class="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div>
        <p class="font-inter text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Shared audio overview
        </p>
        <h1 data-testid="public-audio-title" class="mt-1 font-dm-sans text-2xl font-bold text-foreground sm:text-3xl">
          {{ overview.title }}
        </h1>
        <p class="mt-1 font-inter text-xs text-muted-foreground">
          {{ totalLabel }} total · {{ turns.length }} turns<template v-if="publishedLabel"> · shared {{ publishedLabel }}</template>
        </p>
      </div>

      <section class="grid grid-cols-2 gap-3 sm:gap-4">
        <div
          class="relative flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors sm:gap-3 sm:p-6"
          :class="activeTurn?.speaker === 'host_a' ? 'border-primary/70 bg-card' : 'border-border/60 bg-card/60 opacity-80'"
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
            <p class="font-dm-sans text-sm font-medium text-foreground">Host A · Expert</p>
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
            <p class="font-dm-sans text-sm font-medium text-foreground">Host B · Learner</p>
            <p
              class="mt-0.5 font-inter text-xs"
              :class="activeTurn?.speaker === 'host_b' ? 'text-primary' : 'text-muted-foreground'"
            >
              {{ activeTurn?.speaker === 'host_b' ? 'Speaking' : '—' }}
            </p>
          </div>
        </div>
      </section>

      <div
        v-if="isDialogueFormat"
        data-testid="public-audio-active-quote"
        class="max-w-2xl space-y-3 self-center overflow-y-auto px-4"
        style="max-height: 280px"
      >
        <div
          v-for="(line, idx) in dialogueLines"
          :key="idx"
          class="flex gap-3"
          :class="line.alignClass"
        >
          <div
            class="max-w-[85%] rounded-2xl px-4 py-2.5 font-dm-sans text-sm leading-relaxed sm:text-base"
            :class="line.bubbleClass"
          >
            <p class="mb-1 font-inter text-[11px] font-medium tracking-wide text-muted-foreground">
              {{ line.speakerLabel }}
            </p>
            {{ line.text }}
          </div>
        </div>
      </div>
      <blockquote
        v-else
        data-testid="public-audio-active-quote"
        class="max-w-2xl self-center text-center font-dm-sans text-base leading-relaxed text-foreground sm:text-lg"
      >
        <span class="mr-1 text-primary">"</span>{{ activeQuote }}<span class="ml-1 text-primary">"</span>
        <p class="mt-2 font-inter text-xs text-muted-foreground">
          {{ activeAttribution }}
        </p>
      </blockquote>

      <div
        v-if="hasMissingTurnUrl"
        class="rounded-lg border border-rose-400/50 bg-rose-950/40 p-3 text-center font-inter text-xs text-rose-200"
      >
        An audio segment couldn't be loaded. Try reloading the page.
      </div>

      <section class="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
        <div class="flex items-center gap-3">
          <span class="w-12 font-inter text-xs tabular-nums text-muted-foreground">{{ currentLabel }}</span>
          <input
            type="range"
            min="0"
            max="1000"
            :value="Math.round(progressPercent * 10)"
            data-testid="public-audio-scrubber"
            class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border/40 accent-primary"
            @input="handleScrubInput"
          />
          <span class="w-12 text-right font-inter text-xs tabular-nums text-muted-foreground">{{ totalLabel }}</span>
        </div>

        <div class="mt-4 grid grid-cols-3 items-center gap-2">
          <div />
          <div class="flex items-center justify-center gap-3">
            <button
              type="button"
              data-testid="public-audio-skip-back"
              aria-label="Skip back 10 seconds"
              class="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent/20"
              @click="skip(-10000)"
            >
              <Rewind class="h-4 w-4" />
            </button>
            <button
              type="button"
              data-testid="public-audio-play-btn"
              :aria-label="isPlaying ? 'Pause' : 'Play'"
              class="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-[1.03]"
              @click="togglePlay"
            >
              <Pause v-if="isPlaying" class="h-5 w-5" />
              <Play v-else class="h-5 w-5" />
            </button>
            <button
              type="button"
              data-testid="public-audio-skip-forward"
              aria-label="Skip forward 10 seconds"
              class="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent/20"
              @click="skip(10000)"
            >
              <FastForward class="h-4 w-4" />
            </button>
          </div>
          <div />
        </div>

        <div class="mt-2 flex items-center justify-center gap-2">
          <div class="relative">
            <button
              type="button"
              data-testid="public-audio-speed-btn"
              class="inline-flex h-8 items-center gap-1 rounded-full border border-border/60 bg-background px-3 font-inter text-xs font-medium text-foreground transition-colors hover:bg-accent/20"
              @click="toggleSpeedMenu"
            >
              {{ playbackRate }}x
              <span aria-hidden="true" class="text-muted-foreground">▾</span>
            </button>
            <div
              v-if="speedMenuOpen"
              class="absolute bottom-full left-0 z-10 mb-2 min-w-24 rounded-lg border border-border/60 bg-card p-1 shadow-md"
            >
              <button
                v-for="opt in speedOptions"
                :key="opt"
                type="button"
                class="block w-full rounded-md px-3 py-1.5 text-left font-inter text-xs hover:bg-accent/20"
                :class="opt === playbackRate ? 'text-primary' : 'text-foreground'"
                @click="pickSpeed(opt)"
              >
                {{ opt }}x
              </button>
            </div>
          </div>
          <button
            type="button"
            data-testid="public-audio-download-btn"
            aria-label="Download audio overview"
            :disabled="downloading || turnUrls.length === 0"
            class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleDownload"
          >
            <Download class="h-3.5 w-3.5" :class="downloading ? 'animate-pulse' : ''" />
          </button>
        </div>
      </section>

      <section v-if="sourceFilenames.length > 0">
        <p class="font-inter text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Sources grounding this overview
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
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

    <footer class="mx-auto mt-auto w-full max-w-4xl border-t border-border/60 pt-6 text-center">
      <NuxtLink to="/" class="font-inter text-sm font-medium text-primary hover:underline">
        Create your own audio overview in Budds →
      </NuxtLink>
    </footer>

    <audio ref="audioEl" preload="metadata" class="hidden" />
    <audio ref="preloadEl" preload="auto" class="hidden" />
  </div>
</template>
