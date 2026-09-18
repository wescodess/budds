export type LearnV2PlanResult = {
  status?: 'feasible' | 'infeasible'
  reasonCodes?: string[]
  alternatives?: Array<{ code?: string }>
}

/** Legacy plan snapshots are persisted data, so treat them as untrusted at the
 * UI boundary. A malformed historical row must degrade to an actionable plan
 * card instead of taking down the learner workspace. */
export function parseLearnV2PlanResult(value?: string | null): LearnV2PlanResult {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const row = parsed as Record<string, unknown>
    return {
      status: row.status === 'feasible' || row.status === 'infeasible' ? row.status : undefined,
      reasonCodes: Array.isArray(row.reasonCodes) ? row.reasonCodes.filter((item): item is string => typeof item === 'string') : undefined,
      alternatives: Array.isArray(row.alternatives)
        ? row.alternatives.flatMap((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).code === 'string'
          ? [{ code: (item as Record<string, string>).code }]
          : [])
        : undefined,
    }
  }
  catch {
    return {}
  }
}
