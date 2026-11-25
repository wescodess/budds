import { expect, it } from 'vitest'
import { reactive, toRaw } from 'vue'
import { createTimeoutScope } from '../../support/timeout-isolation'

it('restores reactive collections without replacing their raw keys or values', () => {
  const key = { id: 'original' }
  const other = { id: 'predecessor' }
  const value = { title: 'Goal:' }
  const map = reactive(new Map([[key, value]]))
  const set = reactive(new Set([key]))
  const predecessor = createTimeoutScope()
  predecessor.run(() => {
    map.clear()
    map.set(other, { title: 'Review daily.' })
    set.clear()
    set.add(other)
  })
  predecessor.close()
  expect([...toRaw(map).keys()]).toEqual([key])
  expect([...toRaw(map).keys()][0]).toBe(key)
  expect(toRaw(map).get(key)).toBe(value)
  expect([...toRaw(set)]).toEqual([key])
  expect([...toRaw(set)][0]).toBe(key)
})
