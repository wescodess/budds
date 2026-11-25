import { expect, test } from 'vitest'

let release!: () => void
const gate = new Promise<void>(resolve => { release = resolve })
let recordSignal!: (signal: AbortSignal) => void
const completedSignal = new Promise<AbortSignal>(resolve => { recordSignal = resolve })

test('a successful test leaves a deferred callback', ({ signal }) => {
  recordSignal(signal)
  void gate.then(() => { throw new Error('late-success-callback') })
  expect(signal.aborted).toBe(false)
})

test('a successor releases the successful callback', async () => {
  expect((await completedSignal).aborted).toBe(false)
  release()
  await new Promise(resolve => setTimeout(resolve, 20))
})
