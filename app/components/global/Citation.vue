<script setup lang="ts">
import type { Source } from '~/composables/useChat'

const props = defineProps<{
  index: number | string
}>()

const sources = inject<Ref<Source[]>>('chatCitationSources', ref([]))
const onClick = inject<(i: number) => void>('chatCitationClick', () => {})
const onOpenInKnowledge = inject<(i: number) => void>('chatCitationOpenInKnowledge', () => {})

const indexNum = computed(() => Number(props.index))
const source = computed(() => sources.value[indexNum.value - 1])
</script>

<template>
  <ChatCitationBadge
    :index="indexNum"
    :filename="source?.filename"
    :score="source?.score"
    :content="source?.content"
    @click="onClick(indexNum)"
    @open-in-knowledge="onOpenInKnowledge(indexNum)"
  />
</template>
