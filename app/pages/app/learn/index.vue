<script setup lang="ts">
const router = useRouter()
const { allowed, checkingAccess, hub } = useLearnV2Journey()
function openMission(id: string) { void router.push(`/app/learn/${id}`) }
</script>
<template><main><section v-if="checkingAccess" class="mx-auto max-w-2xl p-6" aria-live="polite"><h1 class="font-dm-sans text-2xl font-bold">Learn</h1><p class="mt-2 text-muted-foreground">Checking access…</p></section><section v-else-if="!allowed" class="mx-auto max-w-2xl p-6"><h1 class="font-dm-sans text-2xl font-bold">Learn</h1><p class="mt-2 text-muted-foreground">This learning experience is not available for this account.</p></section><LearnV2LearnHub v-else :snapshot="hub" @create="router.push('/app/learn/create')" @open-mission="openMission" @start-session="openMission" @continue-setup="openMission" /></main></template>
