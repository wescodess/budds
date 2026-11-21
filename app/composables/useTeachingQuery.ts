import { getFunctionName, makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from 'convex/server'
import type { MaybeRefOrGetter, Ref } from 'vue'
import { LEARN_MEASUREMENT_CAPABILITIES } from '#shared/learn-v2-measurement-storage-manifest'
import type { LearnHelpAdmission } from '../../convex/lib/learnV2HelpContract'

type Query = FunctionReference<'query'>

export type TeachingReadDenial = 'test_open' | 'disclosure_unknown' | 'unavailable'
export type TeachingReadFailure = { reason: TeachingReadDenial | 'error', retryable: boolean, message: string | null }

const DENIALS: readonly TeachingReadDenial[] = ['test_open', 'disclosure_unknown', 'unavailable']
const PAUSED_COPY: Partial<Record<TeachingReadDenial, string>> = {
  test_open: 'This is paused while you have a check open. Finish the check, then come back.',
  disclosure_unknown: 'This isn’t available right now.',
}

export class TeachingReadDeniedError extends Error {
  constructor(readonly reason: TeachingReadDenial) {
    super('Teaching content is unavailable.')
    this.name = 'TeachingReadDeniedError'
  }
}

export function teachingReadDenial(cause: unknown): TeachingReadDenial | null {
  if (cause instanceof TeachingReadDeniedError) return cause.reason
  const admission = (cause as { data?: { admission?: { status?: unknown, reasonCode?: unknown } } } | null | undefined)?.data?.admission
  if (admission?.status !== 'denied') return null
  return DENIALS.includes(admission.reasonCode as TeachingReadDenial) ? admission.reasonCode as TeachingReadDenial : 'unavailable'
}

export function teachingReadFailure(cause: unknown): TeachingReadFailure | null {
  if (!cause) return null
  const reason = teachingReadDenial(cause) ?? 'error'
  const message = reason === 'error' ? null : PAUSED_COPY[reason] ?? null
  return { reason, retryable: message === null, message }
}

function withFailure<T extends { error?: Ref<unknown> }>(result: T) {
  return Object.assign(result, { failure: computed(() => teachingReadFailure(result.error?.value)) })
}

export function useTeachingQuery<Q extends Query>(query: Q, args: MaybeRefOrGetter<FunctionArgs<Q>>, options: Parameters<typeof useConvexQuery>[2] = {}) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || import.meta.server) return withFailure(useConvexQuery(query, args, options))
  const client = useConvex()
  const data = shallowRef<FunctionReturnType<Q> | null>(null)
  const error = shallowRef<Error | null>(null)
  const pending = ref(true)
  const status = ref<'idle' | 'pending' | 'success' | 'error'>('pending')
  const delivery = makeFunctionReference<'mutation', FunctionArgs<Q> & { idempotencyKey: string }, { admission: LearnHelpAdmission, value: FunctionReturnType<Q> | null }>(`${getFunctionName(query)}Delivery`)
  let stop: (() => void) | undefined
  let generation = 0
  const refresh = async () => {
    stop?.()
    const current = ++generation
    data.value = null
    error.value = null
    if (toValue(options.enabled) === false) { pending.value = false; status.value = 'idle'; return }
    pending.value = true
    status.value = 'pending'
    const input = toValue(args)
    let revision = 0
    const idempotencyKey = `teaching_read_${crypto.randomUUID()}`
    const fail = (cause: unknown) => {
      if (current !== generation) return
      data.value = null
      pending.value = false
      status.value = 'error'
      error.value = cause instanceof Error ? cause : new Error('Teaching content is unavailable.')
    }
    stop = client.onUpdate(query, input, value => {
      if (current !== generation) return
      revision++
      data.value = value
      pending.value = false
      status.value = 'success'
      error.value = null
    }, async cause => {
      if (current !== generation) return
      const receiptRevision = ++revision
      data.value = null
      if (!String(cause).includes('help_delivery_required')) { fail(cause); return }
      try {
        const result = await client.mutation(delivery, { ...input, idempotencyKey })
        if (current !== generation || receiptRevision !== revision) return
        if (result.admission.status === 'denied') { fail(new TeachingReadDeniedError(result.admission.reasonCode)); return }
        data.value = result.value
        pending.value = false
        status.value = 'success'
        error.value = null
      } catch (cause) { fail(cause) }
    })
  }
  watch(() => [JSON.stringify(toValue(args)), toValue(options.enabled)], refresh, { immediate: true })
  onScopeDispose(() => { generation++; stop?.() })
  return withFailure({ data, error, pending, status, refresh, execute: refresh, clear: () => { generation++; stop?.(); data.value = null; pending.value = false; status.value = 'idle' } })
}
