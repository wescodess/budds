import { expect, test } from 'vitest'

let reject!: (error: Error) => void
const gate = new Promise<void>((_resolve, fail) => { reject = fail })
let recordSignal!: (signal: AbortSignal) => void
const completedSignal = new Promise<AbortSignal>(resolve => { recordSignal = resolve })

test('a successful test leaves a pending rejection', ({ signal }) => {
  recordSignal(signal)
  void (async () => { await gate })()
  expect(signal.aborted).toBe(false)
})

test('a successor rejects the successful test promise', async () => {
  expect((await completedSignal).aborted).toBe(false)
  reject(new Error('late-success-rejection'))
  await new Promise(resolve => setTimeout(resolve, 20))
})
