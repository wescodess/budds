import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearOfflineData } from '~/composables/useOfflineCache'

describe('adaptive response cleanup', () => {
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

  it('removes every owner-scoped response draft during the shared sign-out/account-deletion cleanup', async () => {
    sessionStorage.setItem('learn-response:owner_1:thread_1:activity_1', 'private answer one')
    sessionStorage.setItem('learn-response:owner_2:thread_2:activity_2', 'private answer two')
    sessionStorage.setItem('unrelated-key', 'keep me')
    vi.stubGlobal('indexedDB', { deleteDatabase: () => {
      const request: { onsuccess?: () => void, onerror?: () => void, onblocked?: () => void } = {}
      queueMicrotask(() => request.onsuccess?.())
      return request
    } })
    await clearOfflineData()
    expect(sessionStorage.getItem('learn-response:owner_1:thread_1:activity_1')).toBeNull()
    expect(sessionStorage.getItem('learn-response:owner_2:thread_2:activity_2')).toBeNull()
    expect(sessionStorage.getItem('unrelated-key')).toBe('keep me')
  })
})
