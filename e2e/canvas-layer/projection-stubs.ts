import { onMounted, ref } from 'vue'

// The fixture exercises renderer output only. Any accidental command fails
// locally; it never reaches Convex, a provider, or durable learner state.
Object.defineProperty(globalThis, '__buddsCanvasProjectionOnly', { value: true, configurable: true })

export function useHarnessMutation() {
  return { mutate: async () => { throw new Error('Canvas browser projection cannot dispatch mutations') } }
}

export function useHarnessAction() {
  return { mutate: async () => { throw new Error('Canvas browser projection cannot dispatch actions') } }
}

export function useHarnessQuery() {
  // Production's SSR branch starts with null. Match it during hydration, then
  // supply the deterministic empty artifact list on the client.
  const data = ref<unknown[] | null>(null)
  onMounted(() => { data.value = [] })
  return { data, pending: ref(false) }
}
