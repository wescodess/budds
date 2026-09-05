import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, isRef, ref } from 'vue'
import { useDocuments } from '~/composables/useDocuments'
import type { Id } from '../../../convex/_generated/dataModel'

const mockUseConvexQuery = vi.fn()
const convexAuthReady = ref(false)
const convexAuthenticated = ref(false)

describe('useDocuments authentication boundary', () => {
  beforeEach(() => {
    convexAuthReady.value = false
    convexAuthenticated.value = false
    mockUseConvexQuery.mockReset().mockReturnValue({ data: ref([]) })
    vi.stubGlobal('isRef', isRef)
    vi.stubGlobal('useConvexQuery', mockUseConvexQuery)
    vi.stubGlobal('useConvexMutation', () => ({ mutate: vi.fn(), isLoading: ref(false) }))
    vi.stubGlobal('useConvexAction', () => ({ mutate: vi.fn(), isLoading: ref(false) }))
    vi.stubGlobal('useNuxtApp', () => ({
      $convexAuthReady: convexAuthReady,
      $convexAuthenticated: convexAuthenticated,
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('[P0] does not subscribe until the user session and Convex auth are both ready', () => {
    const scope = effectScope()
    scope.run(() => useDocuments(ref('folder_1' as Id<'folders'>)))

    const options = mockUseConvexQuery.mock.calls[0]?.[2]
    expect(options?.enabled.value).toBe(false)

    convexAuthReady.value = true
    expect(options.enabled.value).toBe(false)

    convexAuthenticated.value = true
    expect(options.enabled.value).toBe(true)

    convexAuthenticated.value = false
    expect(options.enabled.value).toBe(false)
    scope.stop()
  })
})
