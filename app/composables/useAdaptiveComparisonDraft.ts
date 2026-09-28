import type { Ref } from 'vue'

const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000
const MAX_RATIONALE_LENGTH = 12_000
const MAX_SOURCE_REF_LENGTH = 200

// Local, bounded unfinished work. It is never an evidence or scoring record.
export function useAdaptiveComparisonDraft(
  key: Ref<string | null>,
  sourceRef: Ref<string>,
  rationale: Ref<string>,
  committed: Ref<boolean>,
) {
  function remove(targetKey: string) {
    try { sessionStorage.removeItem(targetKey) } catch { /* Storage may be disabled. */ }
  }

  function restore(targetKey: string | null) {
    // Once the server has a response, these refs represent that response, not local work.
    if (committed.value) { if (targetKey) remove(targetKey); return }
    sourceRef.value = ''
    rationale.value = ''
    if (!targetKey) return
    try {
      const stored = JSON.parse(sessionStorage.getItem(targetKey) ?? 'null') as { sourceRef?: unknown, rationale?: unknown, savedAt?: unknown } | null
      if (!stored || typeof stored.sourceRef !== 'string' || stored.sourceRef.length > MAX_SOURCE_REF_LENGTH
        || typeof stored.rationale !== 'string' || stored.rationale.length > MAX_RATIONALE_LENGTH
        || typeof stored.savedAt !== 'number' || !Number.isFinite(stored.savedAt)
        || Date.now() - stored.savedAt > DRAFT_TTL_MS || stored.savedAt > Date.now()) { remove(targetKey); return }
      sourceRef.value = stored.sourceRef
      rationale.value = stored.rationale
    }
    catch { remove(targetKey) }
  }

  onMounted(() => restore(key.value))
  watch(key, value => restore(value))

  watch([sourceRef, rationale, committed, key], ([source, text, saved, targetKey]) => {
    if (!targetKey) return
    if (saved || !source && !text) { remove(targetKey); return }
    if (source.length > MAX_SOURCE_REF_LENGTH || text.length > MAX_RATIONALE_LENGTH) return
    try { sessionStorage.setItem(targetKey, JSON.stringify({ sourceRef: source, rationale: text, savedAt: Date.now() })) } catch { /* Keep the in-memory draft. */ }
  })
}
