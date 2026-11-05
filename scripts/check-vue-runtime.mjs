import { readFile } from 'node:fs/promises'

const lockfile = await readFile(process.argv[2] || new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
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
// Check both package records and snapshots, including peer-qualified snapshots.
for (const match of lockfile.matchAll(/^ {2}'?(vue|@vue\/[a-z-]+)@([^\s'(:]+)(?:\([^\n]*)?'?:(?: \{\})?$/gm)) {
  versions.get(match[1])?.add(match[2])
}

const vueVersions = versions.get('vue')
const expected = [...vueVersions][0]
const errors = []
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
