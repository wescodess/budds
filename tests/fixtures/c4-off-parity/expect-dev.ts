import { expect } from 'vitest'
import fixtures from './dev-58d2ae62.json'

export const recordingDev = import.meta.env.C4_RECORD_DEV === '58d2ae62238a86b60ce467716c121e6829813fcd'
export function expectDev(key: string, value: unknown) {
  const serialized = JSON.parse(JSON.stringify(value))
  if (recordingDev) console.log(`C4_DEV_FIXTURE ${JSON.stringify({ key, value: serialized })}`)
  else {
    expect(Object.hasOwn(fixtures, key), `Missing pinned dev fixture: ${key}`).toBe(true)
    expect(serialized).toEqual(fixtures[key as keyof typeof fixtures])
  }
}
