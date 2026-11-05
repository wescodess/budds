<script setup lang="ts">
import type { Source } from '~/composables/useChat'

const props = defineProps<{
  index: number | string
}>()

const sources = inject<Ref<Source[]>>('chatCitationSources', ref([]))
const onClick = inject<(i: number) => void>('chatCitationClick', () => {})
const onLongPress = inject<(i: number) => void>('chatCitationLongPress', () => {})
const onOpenInKnowledge = inject<(i: number) => void>('chatCitationOpenInKnowledge', () => {})

const indexNum = computed(() => Number(props.index))
const source = computed(() => sources.value[indexNum.value - 1])
const knownIndex = computed(() => Number.isSafeInteger(indexNum.value) && indexNum.value > 0 && Boolean(source.value))
</script>

<template>
  <ChatCitationBadge
    v-if="knownIndex"
    :index="indexNum"
    :filename="source?.filename"
    :score="source?.score"
    :content="source?.content"
    @click="onClick(indexNum)"
    @long-press="onLongPress(indexNum)"
    @open-in-knowledge="onOpenInKnowledge(indexNum)"
  />
  <template v-else>[{{ indexNum }}]</template>
</template>
