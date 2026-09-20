import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = process.cwd()

function runtimeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return runtimeFiles(path)
    return ['.ts', '.js', '.mjs'].includes(extname(entry.name)) && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

describe('server runtime import boundary', () => {
  test('does not import build-time scripts into the Nuxt server bundle', () => {
    const offenders = runtimeFiles(join(root, 'server'))
      .filter(path => /(?:from\s+|import\s*\()['"](?:\.\.\/)+scripts\//u.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path))

    expect(offenders).toEqual([])
  })
})
