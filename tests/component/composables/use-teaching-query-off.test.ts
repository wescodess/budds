import { describe, expect, it } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { effectScope } from 'vue'
import { api } from '#convex/api'

const data = ref<unknown>(null)
const error = ref<Error | null>(null)
const convexQueryResult = { data, error, pending: ref(false), status: ref('success'), refresh: async () => {} }

mockNuxtImport('useConvexQuery', () => () => convexQueryResult)

describe('useTeachingQuery with responses off', () => {
  it('returns the nuxt-convex result untouched and never reports a failure', async () => {
    const { useTeachingQuery } = await import('~/composables/useTeachingQuery')
    const scope = effectScope()
    const read = scope.run(() => useTeachingQuery(api.learnV2SessionContent.getSessionContent, { studySessionId: 'session_1' as never }))!
    expect(read.data).toBe(data)
    expect(read.error).toBe(error)

    error.value = Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode: 'test_open' } } })
    expect(read.failure.value).toBeNull()
    error.value = new Error('SSR query failed')
    data.value = { revision: 1, blocks: [] }
    expect(read.failure.value).toBeNull()
    expect(read.data.value).toEqual({ revision: 1, blocks: [] })
    scope.stop()
  })
})
