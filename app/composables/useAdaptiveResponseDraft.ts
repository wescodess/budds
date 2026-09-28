import type { Ref } from 'vue'

const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000
const MAX_RESPONSE_LENGTH = 12_000

// A local, owner-and-activity-scoped refresh buffer. It never becomes server
// evidence and is discarded as soon as an authoritative response is present.
export function useAdaptiveResponseDraft(
  key: string | null,
  response: Ref<string>,
  committed: Ref<boolean>,
  confidence?: Ref<number | null>,
) {
  function remove() {
    if (!key) return
    try { sessionStorage.removeItem(key) } catch { /* Storage may be disabled. */ }
  }

  onMounted(() => {
    if (!key) return
    if (committed.value) { remove(); return }
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null') as { response?: unknown, confidence?: unknown, savedAt?: unknown } | null
      if (!stored || typeof stored.response !== 'string' || stored.response.length > MAX_RESPONSE_LENGTH
        || typeof stored.savedAt !== 'number' || Date.now() - stored.savedAt > DRAFT_TTL_MS || stored.savedAt > Date.now()) { remove(); return }
      response.value = stored.response
      if (confidence && (stored.confidence === null || (typeof stored.confidence === 'number' && Number.isInteger(stored.confidence) && stored.confidence >= 1 && stored.confidence <= 5))) confidence.value = stored.confidence
    }
    catch { remove() }
  })

  watch([response, committed, confidence ?? ref(null)], ([value, saved, certainty]) => {
    if (!key) return
    if (saved || !value) { remove(); return }
    if (value.length > MAX_RESPONSE_LENGTH) return
    try { sessionStorage.setItem(key, JSON.stringify({ response: value, confidence: certainty, savedAt: Date.now() })) } catch { /* Keep the in-memory draft. */ }
  })
}
