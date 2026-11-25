import { expect, onTestFinished, test, vi } from 'vitest'

const state = { value: 0, unmounts: 0 }
const rows: string[] = []
const map = new Map<string, number>()
const set = new Set<string>()
const queue = vi.fn().mockReturnValue('default')
const target = { read: () => 0 }

test('success leaves state and resources until their own cleanup', () => {
  state.value = 1
  rows.push('retained')
  map.set('retained', 1)
  set.add('retained')
  queue.mockReturnValueOnce('retained')
  vi.spyOn(target, 'read').mockReturnValue(1)
  vi.stubEnv('BUDDS_NORMAL_COMPLETION_PROBE', 'retained')
  vi.stubGlobal('__buddsNormalCompletionProbe', 'retained')
  vi.useFakeTimers()
  const wrapper = { __app: true, unmount() { state.unmounts++ } }
  const runtime = Reflect.get(globalThis, '__buddsTimeoutIsolation')
  runtime?.ownWrapper(wrapper)
  expect(state.unmounts).toBe(0)
})

test('native state remains observable before explicit cleanup', () => {
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  expect(state).toEqual({ value: 1, unmounts: 0 })
  expect(rows).toEqual(['retained'])
  expect([...map]).toEqual([['retained', 1]])
  expect([...set]).toEqual(['retained'])
  expect(queue()).toBe('retained')
  expect(target.read()).toBe(1)
  expect(process.env.BUDDS_NORMAL_COMPLETION_PROBE).toBe('retained')
  expect(Reflect.get(globalThis, '__buddsNormalCompletionProbe')).toBe('retained')
  expect(vi.isFakeTimers()).toBe(true)
})
