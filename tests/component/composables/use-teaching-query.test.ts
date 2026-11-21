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

  async function setup() {
    const { useTeachingQuery } = await import('~/composables/useTeachingQuery')
    return scope.run(() => useTeachingQuery(api.learnV2SessionContent.getSessionContent, { studySessionId: 'session_1' as never }))!
  }

  it('keeps the typed open-check denial from delivery and offers no retry', async () => {
    mutation.mockResolvedValue({ admission: { version: 'v', status: 'denied', reasonCode: 'test_open' }, value: null })
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    await vi.waitFor(() => expect(read.status.value).toBe('error'))
    expect(getFunctionName(mutation.mock.calls[0]![0])).toBe('learnV2SessionContent:getSessionContentDelivery')
    expect(read.data.value).toBeNull()
    expect(read.pending.value).toBe(false)
    expect(read.failure.value).toEqual({ reason: 'test_open', retryable: false, message: 'This is paused while you have a check open. Finish the check, then come back.' })
  })

  it('maps an unknown disclosure from the query itself to plain copy without retry', async () => {
    const read = await setup()
    subscriptions[0]!.onError(deniedBy('disclosure_unknown'))
    await nextTick()
    expect(mutation).not.toHaveBeenCalled()
    expect(read.failure.value).toEqual({ reason: 'disclosure_unknown', retryable: false, message: 'This isn’t available right now.' })
  })

  it('treats unavailable denials and network failures as retryable errors', async () => {
    mutation.mockResolvedValueOnce({ admission: { version: 'v', status: 'denied', reasonCode: 'unavailable' }, value: null })
    const read = await setup()
    subscriptions[0]!.onError(deliveryRequired())
    await vi.waitFor(() => expect(read.failure.value).toEqual({ reason: 'unavailable', retryable: true, message: null }))

    mutation.mockRejectedValueOnce(new Error('Network down'))
    await read.refresh()
    subscriptions[1]!.onError(deliveryRequired())
    await vi.waitFor(() => expect(read.failure.value).toEqual({ reason: 'error', retryable: true, message: null }))
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
