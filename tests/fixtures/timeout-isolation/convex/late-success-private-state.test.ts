import { expect, test } from 'vitest'

let release!: () => void
const gate = new Promise<void>(resolve => { release = resolve })
let recordSignal!: (signal: AbortSignal) => void
const completedSignal = new Promise<AbortSignal>(resolve => { recordSignal = resolve })

test('success leaves live work holding private mutable state', ({ signal }) => {
  recordSignal(signal)
  const state = { shouldFail: false }
  state.shouldFail = true
  void (async () => {
    await gate
    if (state.shouldFail) throw new Error('late-success-private-state')
  })()
  expect(signal.aborted).toBe(false)
})

test('a successor releases the successful continuation', async () => {
  expect((await completedSignal).aborted).toBe(false)
  release()
  await new Promise(resolve => setTimeout(resolve, 20))
})
