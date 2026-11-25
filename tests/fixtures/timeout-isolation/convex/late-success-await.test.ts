import { expect, test } from 'vitest'

let release!: () => void
const gate = new Promise<void>(resolve => { release = resolve })
let recordSignal!: (signal: AbortSignal) => void
const completedSignal = new Promise<AbortSignal>(resolve => { recordSignal = resolve })

test('a successful test leaves an awaited continuation', ({ signal }) => {
  recordSignal(signal)
  void (async () => {
    await gate
    expect('actual', 'late-success-await').toBe('expected')
  })()
  expect(signal.aborted).toBe(false)
})

test('a successor releases the successful continuation', async () => {
  expect((await completedSignal).aborted).toBe(false)
  release()
  await new Promise(resolve => setTimeout(resolve, 20))
})
