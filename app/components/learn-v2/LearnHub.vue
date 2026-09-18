<script setup lang="ts">
import { BookOpen, CalendarClock, ChevronRight, Plus, Sparkles } from '@lucide/vue'
import type { LearnHubSnapshot, LearnMissionSnapshot } from '~/types/learn-v2-journey'

const { snapshot } = defineProps<{ snapshot: LearnHubSnapshot }>()
const emit = defineEmits<{ create: []; openMission: [missionId: string]; startSession: [missionId: string]; continueSetup: [missionId: string] }>()
function primaryAction(mission: LearnMissionSnapshot) { if (mission.nextAction.kind === 'start_session' || mission.nextAction.kind === 'resume_session' || mission.nextAction.kind === 'review_now') emit('startSession', mission.id); else emit('continueSetup', mission.id) }
</script>

<template>
  <main class="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:py-10" data-testid="learn-v2-hub">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p class="font-inter text-xs font-medium uppercase tracking-[0.16em] text-primary">Learning workspace</p><h1 class="mt-1 font-dm-sans text-3xl font-bold tracking-tight">Learn</h1><p class="mt-2 text-sm text-muted-foreground">Build capability from evidence, one deliberate session at a time.</p></div>
      <UiButton data-testid="learn-v2-hub-create" class="gap-2" @click="emit('create')"><Plus class="h-4 w-4" />New learning plan</UiButton>
    </header>

    <section v-if="snapshot.today" aria-labelledby="learn-v2-hub-today" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <UiCard class="border-primary/30 bg-gradient-to-br from-card to-primary/5 p-5 sm:p-6"><div class="flex items-start justify-between gap-4"><div><p class="font-inter text-xs font-medium uppercase tracking-wide text-primary">Your next best action</p><h2 id="learn-v2-hub-today" class="mt-2 font-dm-sans text-xl font-bold">{{ snapshot.today.title }}</h2><p class="mt-1 text-sm text-muted-foreground">{{ snapshot.today.nextAction.detail }}</p></div><Sparkles class="h-5 w-5 shrink-0 text-primary" /></div><div class="mt-5 flex flex-wrap items-center gap-3"><UiButton data-testid="learn-v2-hub-next-action" @click="primaryAction(snapshot.today)">{{ snapshot.today.nextAction.label }}<ChevronRight class="ml-1 h-4 w-4" /></UiButton><button type="button" class="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="emit('openMission', snapshot.today.id)">Open workspace</button></div></UiCard>
      <UiCard class="p-5"><div class="flex items-center gap-2 text-sm font-medium"><CalendarClock class="h-4 w-4 text-primary" />Coming up</div><p class="mt-3 text-sm text-muted-foreground">{{ snapshot.today.upcomingLabel ?? 'Your schedule is ready when you are.' }}</p><p class="mt-4 font-inter text-xs text-muted-foreground">{{ snapshot.today.mastery.retained }} retained · {{ snapshot.today.mastery.independent }} independent</p></UiCard>
    </section>
    <section v-else class="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center"><BookOpen class="mx-auto h-6 w-6 text-primary" /><h2 class="mt-3 font-dm-sans text-xl font-bold">Make your first learning plan</h2><p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Start with an outcome. Budds helps you review evidence, shape a map, and schedule deliberate practice.</p><UiButton class="mt-5" @click="emit('create')">Create a learning plan</UiButton></section>
    <section v-if="snapshot.missions.length" aria-labelledby="learn-v2-hub-missions"><div class="mb-3 flex items-center justify-between"><h2 id="learn-v2-hub-missions" class="font-dm-sans text-lg font-semibold">Your learning plans</h2><span class="font-inter text-xs text-muted-foreground">{{ snapshot.missions.length }} active</span></div><div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><button v-for="mission in snapshot.missions" :key="mission.id" type="button" class="group rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="emit('openMission', mission.id)"><p class="font-inter text-[11px] uppercase tracking-wide text-muted-foreground">{{ mission.folderName }}</p><h3 class="mt-1 line-clamp-2 font-dm-sans text-base font-semibold">{{ mission.title }}</h3><p class="mt-3 text-sm text-muted-foreground">{{ mission.nextAction.label }}</p><p class="mt-3 font-inter text-xs text-muted-foreground">{{ mission.mastery.retained }} retained · {{ mission.mastery.independent }} independent · {{ mission.mastery.learning }} learning</p></button></div></section>
  </main>
</template>
