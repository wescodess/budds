import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', 'scripts/c4-record-dev.config.ts'], { encoding: 'utf8', maxBuffer: 16_000_000 })
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
if (result.status !== 0) process.exit(result.status ?? 1)
const fixtures = {}
for (const line of result.stdout.split('\n')) {
  const marker = line.indexOf('C4_DEV_FIXTURE ')
  if (marker === -1) continue
  const { key, value } = JSON.parse(line.slice(marker + 15))
  if (Object.hasOwn(fixtures, key)) throw new Error(`Duplicate fixture ${key}`)
  fixtures[key] = value
}
if (Object.keys(fixtures).length === 0) throw new Error('No pinned dev fixtures recorded')
writeFileSync('tests/fixtures/c4-off-parity/dev-58d2ae62.json', `${JSON.stringify(Object.fromEntries(Object.entries(fixtures).sort()), null, 2)}\n`)
console.log(`Recorded ${Object.keys(fixtures).length} pinned dev results`)
