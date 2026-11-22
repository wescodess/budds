import { getFunctionName } from 'convex/server'
import { ref, watch, type Ref } from 'vue'
import { vi } from 'vitest'

export type TeachingRead = { data: Ref<unknown>, error: Ref<Error | null>, subscriptions: number }

const reads = new Map<string, TeachingRead>()

export function teachingRead(name: string): TeachingRead {
  let read = reads.get(name)
  if (!read) {
    read = { data: ref(undefined), error: ref(null), subscriptions: 0 }
    reads.set(name, read)
  }
  return read
}

export function resetTeachingReads() {
  for (const read of reads.values()) {
    read.data.value = undefined
    read.error.value = null
    read.subscriptions = 0
  }
}

export const deniedRead = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })

export const teachingClient = {
  onUpdate: vi.fn((query: never, _args: unknown, onValue: (value: unknown) => void, onError?: (cause: Error) => void) => {
    const read = teachingRead(getFunctionName(query))
    read.subscriptions += 1
    return watch([read.data, read.error], ([data, error]) => {
      if (error) onError?.(error)
      else if (data !== undefined) onValue(data)
    }, { immediate: true, flush: 'sync' })
  }),
  mutation: vi.fn(),
  query: vi.fn(),
}
