import { readFile } from 'node:fs/promises'

const lockfile = (await readFile(process.argv[2] || new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
// pnpm 9 uses two-space package/snapshot keys. Fail closed if its format changes.
if (!/^lockfileVersion: '9\.0'$/m.test(lockfile)) {
  throw new Error('Unsupported lockfile format; update the Vue runtime check')
}

const packages = [
  'vue',
  '@vue/reactivity',
  '@vue/runtime-core',
  '@vue/runtime-dom',
  '@vue/server-renderer',
  '@vue/shared',
  '@vue/compiler-core',
  '@vue/compiler-dom',
  '@vue/compiler-sfc',
  '@vue/compiler-ssr',
]
const versions = new Map(packages.map(name => [name, new Set()]))
const errors = []
let checkingRecords = false
// Check both package records and snapshots, including peer-qualified snapshots.
for (const line of lockfile.split('\n')) {
  if (/^\S/.test(line)) {
    checkingRecords = /^(packages|snapshots):$/.test(line)
    continue
  }
  if (!checkingRecords) continue
  const match = line.match(/^ {2}(['"]?)(vue|@vue\/[a-z-]+)@(.+?)\1:(?: \{\})?$/)
  if (!match || !versions.has(match[2])) continue
  const version = match[3].match(/^(\d+\.\d+\.\d+(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?)(?:\([^\n]*\))?$/)
  if (!version) {
    errors.push(`${match[2]}: unsupported resolution ${match[3]}`)
    continue
  }
  versions.get(match[2]).add(version[1])
}

const vueVersions = versions.get('vue')
const expected = [...vueVersions][0]
for (const [name, resolved] of versions) {
  if (resolved.size !== 1 || !resolved.has(expected)) {
    errors.push(`${name}: ${[...resolved].join(', ') || 'missing'} (expected only ${expected || 'one Vue version'})`)
  }
}
if (errors.length) {
  console.error(`Vue runtime must resolve to one aligned version:\n${errors.join('\n')}`)
  process.exit(1)
}

console.log(`Vue runtime check passed: ${packages.length} packages aligned at ${expected}.`)
