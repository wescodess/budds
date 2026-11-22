import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { effectScope, nextTick } from 'vue'
import { getFunctionName } from 'convex/server'
import { api } from '#convex/api'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

type Subscription = { onValue: (value: unknown) => void, onError: (cause: Error) => void }
const subscriptions: Subscription[] = []
const mutation = vi.fn()
const client = {
  onUpdate: vi.fn((_query: unknown, _args: unknown, onValue: Subscription['onValue'], onError: Subscription['onError']) => {
    subscriptions.push({ onValue, onError })
    return () => {}
  }),
  mutation,
}

mockNuxtImport('useConvex', () => () => client)

const deliveryRequired = () => Object.assign(new Error('help_delivery_required'), { data: { code: 'help_delivery_required', admission: { status: 'denied', reasonCode: 'unavailable' } } })
const deniedBy = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })

describe('useTeachingQuery', () => {
  let scope: ReturnType<typeof effectScope>
  beforeEach(() => {
    subscriptions.length = 0
    client.onUpdate.mockClear()
    mutation.mockReset()
    scope = effectScope()
  })
  afterEach(() => scope.stop())

  async function setup(options: { sessionId?: Ref<string>, enabled?: Ref<boolean> } = {}) {
    const { useTeachingQuery } = await import('~/composables/useTeachingQuery')
    return scope.run(() => useTeachingQuery(api.learnV2SessionContent.getSessionContent, computed(() => ({ studySessionId: (options.sessionId?.value ?? 'session_1') as never })), { enabled: options.enabled }))!
  }

  it('keeps the typed open-check denial from delivery and offers no retry', async () => {
    mutation.mockResolvedValue({ admission: { version: 'v', status: 'denied', reasonCode: 'test_open' }, value: null })
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    await vi.waitFor(() => expect(read.status.value).toBe('error'))
    expect(getFunctionName(mutation.mock.calls[0]![0])).toBe('learnV2SessionContent:getSessionContentDelivery')
    expect(read.data.value).toBeNull()
    expect(read.pending.value).toBe(false)
    expect(read.failure.value).toEqual({ reason: 'test_open', retryable: false, revoked: true, message: 'This is paused while you have a check open. Finish the check, then come back.' })
  })

  it('maps an unknown disclosure from the query itself to plain copy without retry', async () => {
    const read = await setup()
    subscriptions[0]!.onError(deniedBy('disclosure_unknown'))
    await nextTick()
    expect(mutation).not.toHaveBeenCalled()
    expect(read.failure.value).toEqual({ reason: 'disclosure_unknown', retryable: false, revoked: true, message: 'This isn’t available right now.' })
  })

  it('treats unavailable denials and network failures as retryable errors', async () => {
    mutation.mockResolvedValueOnce({ admission: { version: 'v', status: 'denied', reasonCode: 'unavailable' }, value: null })
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    await vi.waitFor(() => expect(read.failure.value).toEqual({ reason: 'unavailable', retryable: true, revoked: true, message: null }))

    mutation.mockRejectedValueOnce(new Error('Network down'))
    await read.refresh()
    subscriptions[1]!.onError(deliveryRequired())
    await vi.waitFor(() => expect(read.failure.value).toEqual({ reason: 'error', retryable: true, revoked: false, message: null }))
    expect(read.error.value?.message).toBe('Network down')
  })

  it('recovers on retry and clears the failure', async () => {
    const read = await setup()
    subscriptions[0]!.onError(new Error('Network down'))
    await nextTick()
    expect(read.failure.value?.retryable).toBe(true)

    mutation.mockResolvedValue({ admission: { version: 'v', status: 'delivered' }, value: { revision: 1, blocks: [] } })
    await read.refresh()
    expect(read.failure.value).toBeNull()
    expect(read.pending.value).toBe(true)
    subscriptions[1]!.onError(deliveryRequired())
    await vi.waitFor(() => expect(read.data.value).toEqual({ revision: 1, blocks: [] }))
    expect(read.status.value).toBe('success')
    expect(read.failure.value).toBeNull()
  })

  it('never lets a late delivery result override a newer server denial', async () => {
    let resolveDelivery!: (value: unknown) => void
    mutation.mockReturnValue(new Promise(resolve => { resolveDelivery = resolve }))
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    subscriptions[0]!.onError(deniedBy('test_open'))
    await nextTick()
    resolveDelivery({ admission: { version: 'v', status: 'delivered' }, value: { revision: 9, blocks: [] } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(read.failure.value?.reason).toBe('test_open')
    expect(read.data.value).toBeNull()
  })

  it('ignores a delivery rejection after a newer live-query success', async () => {
    let rejectDelivery!: (reason: Error) => void
    mutation.mockReturnValue(new Promise((_resolve, reject) => { rejectDelivery = reject }))
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    subscriptions[0]!.onValue({ revision: 2, blocks: [] })
    expect(read.status.value).toBe('success')
    rejectDelivery(new Error('Network down'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(read.data.value).toEqual({ revision: 2, blocks: [] })
    expect(read.failure.value).toBeNull()
    expect(read.status.value).toBe('success')
  })

  it('ignores a rejection from a delivery superseded by a newer delivery-required notification', async () => {
    const rejects: Array<(reason: Error) => void> = []
    const resolves: Array<(value: unknown) => void> = []
    mutation.mockImplementation(() => new Promise((resolve, reject) => { resolves.push(resolve); rejects.push(reject) }))
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    subscriptions[0]!.onError(deliveryRequired())
    resolves[1]!({ admission: { version: 'v', status: 'delivered' }, value: { revision: 3, blocks: [] } })
    await vi.waitFor(() => expect(read.data.value).toEqual({ revision: 3, blocks: [] }))
    rejects[0]!(new Error('Network down'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(read.data.value).toEqual({ revision: 3, blocks: [] })
    expect(read.failure.value).toBeNull()
  })

  it('ignores a rejection that settles after a refresh or unsubscribe', async () => {
    let rejectDelivery!: (reason: Error) => void
    mutation.mockReturnValue(new Promise((_resolve, reject) => { rejectDelivery = reject }))
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    void read.refresh()
    subscriptions[1]!.onValue({ revision: 4, blocks: [] })
    rejectDelivery(new Error('Network down'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(read.data.value).toEqual({ revision: 4, blocks: [] })
    expect(read.failure.value).toBeNull()
    scope.stop()
    expect(read.data.value).toEqual({ revision: 4, blocks: [] })
  })

  it.each(['resolve', 'reject'] as const)('ignores a late delivery %s after clear', async (settlement) => {
    const delivery = Promise.withResolvers<unknown>()
    mutation.mockReturnValue(delivery.promise)
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    read.clear()
    if (settlement === 'resolve') delivery.resolve({ admission: { status: 'denied', reasonCode: 'unavailable' }, value: null })
    else delivery.reject(deniedBy('unavailable'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(read.data.value).toBeNull()
    expect(read.failure.value).toBeNull()
    expect(read.status.value).toBe('idle')
    expect(read.pending.value).toBe(false)
    subscriptions[0]!.onValue({ revision: 9, blocks: [] })
    expect(read.data.value).toBeNull()
  })

  it.each(['resolve', 'reject'] as const)('ignores a late delivery %s after disposal and cannot restart', async (settlement) => {
    const delivery = Promise.withResolvers<unknown>()
    mutation.mockReturnValue(delivery.promise)
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    scope.stop()
    const before = { data: read.data.value, error: read.error.value, status: read.status.value, pending: read.pending.value }
    if (settlement === 'resolve') delivery.resolve({ admission: { status: 'delivered' }, value: { revision: 9, blocks: [] } })
    else delivery.reject(deniedBy('unavailable'))
    await new Promise(resolve => setTimeout(resolve, 0))
    subscriptions[0]!.onValue({ revision: 10, blocks: [] })
    subscriptions[0]!.onError(deniedBy('test_open'))
    await read.refresh()
    expect(subscriptions).toHaveLength(1)
    expect({ data: read.data.value, error: read.error.value, status: read.status.value, pending: read.pending.value }).toEqual(before)
  })

  it.each(['args', 'disabled'] as const)('rejects old delivery and subscription callbacks when %s changes', async (change) => {
    const delivery = Promise.withResolvers<unknown>()
    mutation.mockReturnValue(delivery.promise)
    const sessionId = ref('session_1')
    const enabled = ref(true)
    const read = await setup({ sessionId, enabled })
    subscriptions[0]!.onError(deliveryRequired())
    if (change === 'args') sessionId.value = 'session_2'
    else enabled.value = false
    subscriptions[0]!.onValue({ revision: 9, blocks: [] })
    delivery.reject(deniedBy('unavailable'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(read.data.value).toBeNull()
    expect(read.failure.value).toBeNull()
    expect(read.status.value).toBe(change === 'args' ? 'pending' : 'idle')
  })

  it('clears the error as well as content when cleared after denial', async () => {
    const read = await setup()
    subscriptions[0]!.onError(deniedBy('unavailable'))
    expect(read.failure.value?.revoked).toBe(true)
    read.clear()
    expect(read.failure.value).toBeNull()
    expect(read.error.value).toBeNull()
    expect(read.status.value).toBe('idle')
  })

  it('unsubscribes a registration superseded synchronously during its initial callback', async () => {
    const firstStop = vi.fn()
    const secondStop = vi.fn()
    const sessionId = ref('session_1')
    client.onUpdate.mockImplementationOnce((_query, _args, onValue) => {
      onValue({ revision: 1, blocks: [] })
      sessionId.value = 'session_2'
      return firstStop
    }).mockImplementationOnce(() => secondStop)
    await setup({ sessionId })
    expect(client.onUpdate).toHaveBeenCalledTimes(2)
    expect(firstStop).toHaveBeenCalledTimes(1)
    expect(secondStop).not.toHaveBeenCalled()
    scope.stop()
    expect(secondStop).toHaveBeenCalledTimes(1)
  })

  it('clears a denial when the live query later succeeds', async () => {
    const read = await setup()
    subscriptions[0]!.onError(deniedBy('test_open'))
    await nextTick()
    expect(read.failure.value?.reason).toBe('test_open')
    subscriptions[0]!.onValue({ revision: 2, blocks: [] })
    expect(read.failure.value).toBeNull()
    expect(read.data.value).toEqual({ revision: 2, blocks: [] })
  })
})
