<script setup lang="ts">
const props = defineProps<{ code: string }>()

const svg = ref('')
const error = ref(false)
const loading = ref(true)
const container = ref<HTMLElement | null>(null)
const id = useId()

let mermaidPromise: Promise<typeof import('mermaid')> | null = null

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#292524',
          primaryTextColor: '#d6d3d1',
          primaryBorderColor: '#57534e',
          lineColor: '#78716c',
          secondaryColor: '#1c1917',
          tertiaryColor: '#44403c',
          fontFamily: 'inherit',
          fontSize: '14px',
          noteBkgColor: '#292524',
          noteTextColor: '#d6d3d1',
          actorBorder: '#f59e0b',
          signalColor: '#d6d3d1',
        },
      })
      return m
    })
  }
  return mermaidPromise
}

async function render() {
  loading.value = true
  error.value = false
  svg.value = ''

  try {
    const m = await loadMermaid()
    const { svg: rendered } = await m.default.render(`mermaid-${id}`, props.code)
    svg.value = rendered
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => render())
watch(() => props.code, () => render())
</script>

<template>
  <ClientOnly>
    <div class="my-4 overflow-x-auto rounded-lg bg-[#0f0d0c] p-4">
      <div v-if="loading" class="flex items-center justify-center py-8">
        <div class="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
      <div
        v-else-if="svg"
        ref="container"
        class="flex justify-center [&_svg]:max-w-full"
        v-html="svg"
      />
      <div v-else-if="error" class="space-y-2">
        <p class="text-xs text-stone-500">Diagram could not be rendered</p>
        <pre class="overflow-x-auto text-xs text-stone-400"><code>{{ code }}</code></pre>
      </div>
    </div>
    <template #fallback>
      <pre class="my-4 overflow-x-auto rounded-lg bg-[#0f0d0c] p-4 text-xs text-stone-400"><code>{{ code }}</code></pre>
    </template>
  </ClientOnly>
</template>
