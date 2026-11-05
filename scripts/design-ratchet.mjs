import { realpathSync } from 'node:fs'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const rules = [
  'backdrop-blur',
  'gradients',
  'hover-lift',
  'raw-amber-orange',
  'raw-hex',
  'sparkles',
  'style-block',
  'uppercase',
  'violet-indigo',
]

export function countViolations(source) {
  const counts = Object.fromEntries(rules.map(rule => [rule, 0]))
  counts.sparkles = [...source.matchAll(/\bSparkles\b/g)].length
  counts['style-block'] = [...source.matchAll(/<style(?=[\s>])/gi)].length
  counts.gradients = [...source.matchAll(/\bbg-(?:gradient-to-[a-z]+|linear-(?:to-[a-z]+|\d+|\[)|radial|conic)|\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/g)].length

  // Scan all text, including CSS @apply and comments, without pairing quotes.
  // Split only where a class cannot continue, so variants and arbitrary values stay whole.
  for (const raw of source.split(/[\s"'`;]+/)) {
    const token = raw.replace(/^[{(,]+|[,)}>]+$/g, '').replace(/(^|:)!/g, '$1')
    if (/(?:^|:)uppercase!?:?$/.test(token)) counts.uppercase++
    if (/(?:^|:)backdrop-blur(?:-|!?$)/.test(token)) counts['backdrop-blur']++
    if (/(?:^|:)(?:group-|peer-)?hover(?:\/[\w-]+)?:(?:[^:]+:)*(?:scale(?:-[xy])?-|-?translate-[xy]-)/.test(token)) counts['hover-lift']++
    if (/(?:^|:)(?:[a-z]+-)+(?:amber|orange)-\d/.test(token)) counts['raw-amber-orange']++
    if (/(?:^|:)(?:[a-z]+-)+(?:violet|indigo)-\d/.test(token)) counts['violet-indigo']++
    if (/-\[(?:[a-z-]+:)?#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})\]/i.test(token)) counts['raw-hex']++
  }
  return counts
}

export function countFiles(files) {
  const result = Object.fromEntries(rules.map(rule => [rule, {}]))
  for (const file of Object.keys(files).sort()) {
    for (const [rule, count] of Object.entries(countViolations(files[file]))) {
      if (count > 0) result[rule][file] = count
    }
  }
  return result
}

export function compareCounts(baseline, current) {
  const changes = []
  for (const rule of rules) {
    const files = new Set([...Object.keys(baseline[rule]), ...Object.keys(current[rule])])
    for (const file of [...files].sort()) {
      const oldCount = baseline[rule][file] ?? 0
      const newCount = current[rule][file] ?? 0
      if (oldCount !== newCount) changes.push({ rule, file, oldCount, newCount })
    }
  }
  return changes
}

function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)
    || Object.keys(baseline).length !== rules.length
    || rules.some(rule => !Object.hasOwn(baseline, rule))) {
    throw new Error('Baseline must contain exactly the design ratchet rules.')
  }
  for (const files of Object.values(baseline)) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Baseline rules must map files to counts.')
    for (const [file, count] of Object.entries(files)) {
      if (!file.startsWith('app/') || file.includes('\\') || file.split('/').some(part => part === '..' || part === '.' || !part)
        || !Number.isSafeInteger(count) || count < 1) {
        throw new Error(`Invalid baseline entry: ${file} (${count}). Use app/ paths and positive integer counts.`)
      }
    }
  }
}

async function collectFiles(root, directory = 'app') {
  const files = {}
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`
    if (entry.isDirectory()) Object.assign(files, await collectFiles(root, file))
    else if (entry.isFile()) files[file] = await readFile(path.join(root, file), 'utf8')
  }
  return files
}

export async function run(root, args = []) {
  if (args.some(arg => arg !== '--update') || args.length > 1) throw new Error('Usage: pnpm design:ratchet [--update]')
  const baselinePath = path.join(root, 'docs/design/ratchet-baseline.json')
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
  validateBaseline(baseline)
  const current = countFiles(await collectFiles(root))
  const changes = compareCounts(baseline, current)
  const increases = changes.filter(change => change.newCount > change.oldCount)
  const update = args.includes('--update')
  const failures = update ? increases : changes
  if (failures.length > 0) {
    for (const { rule, file, oldCount, newCount } of failures) {
      const fix = newCount > oldCount
        ? 'Remove the added violation; an intentional increase requires a visible baseline hand edit in the PR.'
        : 'Run pnpm design:ratchet --update to lock in the reduction.'
      console.error(`${rule}: ${file}: old ${oldCount}, new ${newCount}. ${fix}`)
    }
    console.error('Design ratchet failed. Baseline unchanged.')
    return 1
  }
  if (update) {
    const temporaryPath = `${baselinePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(current, null, 2)}\n`)
    await rename(temporaryPath, baselinePath)
  }
  console.log(update ? `Design ratchet updated (${changes.length} reductions).` : 'Design ratchet passed (9 rules; baseline matches app/).')
  return 0
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await run(fileURLToPath(new URL('../', import.meta.url)), process.argv.slice(2))
  }
  catch (error) {
    console.error(`Design ratchet failed: ${error.message}`)
    process.exitCode = 1
  }
}
