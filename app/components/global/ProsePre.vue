<script setup>
defineProps({
  code: { type: String, default: '' },
  language: { type: String, default: null },
  filename: { type: String, default: null },
  highlights: { type: Array, default: () => [] },
  meta: { type: String, default: null },
  class: { type: String, default: null },
})
</script>

<template>
  <MermaidDiagram v-if="language === 'mermaid'" :code="code" />
  <pre v-else :class="$props.class"><slot /></pre>
</template>

<style>
pre code .line { display: block }
</style>
