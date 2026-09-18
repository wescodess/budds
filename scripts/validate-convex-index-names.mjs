import { readFile } from 'node:fs/promises'

const schemaUrl = new URL('../convex/schema.ts', import.meta.url)
const schema = await readFile(schemaUrl, 'utf8')
const indexNames = [...schema.matchAll(/\.index\(['"]([^'"]+)['"]/g)].map(match => match[1])
const invalid = indexNames.filter(name => name.length > 64 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name))

if (invalid.length > 0) {
  console.error(`Invalid Convex index name${invalid.length === 1 ? '' : 's'}:`)
  for (const name of invalid) console.error(`- ${name} (${name.length} characters)`)
  process.exit(1)
}

console.log(`Validated ${indexNames.length} Convex index names.`)
