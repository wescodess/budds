import fs from 'node:fs'
import path from 'node:path'

const phase = process.argv[2] || 'build'
const strict = process.argv.includes('--strict')
  || Boolean(process.env.CF_PAGES)
  || Boolean(process.env.CI)

const projectRoot = process.cwd()
const dotenvPaths = [
  path.join(projectRoot, '.env'),
  path.join(projectRoot, '.env.local'),
]

function parseDotenvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const source = fs.readFileSync(filePath, 'utf8')
  const entries = {}

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex < 1) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    entries[key] = value
  }

  return entries
}

const mergedEnv = {
  ...dotenvPaths.reduce((acc, filePath) => ({ ...acc, ...parseDotenvFile(filePath) }), {}),
  ...process.env,
}

const requirements = [
  { kind: 'secret', label: 'Better Auth secret', names: ['NUXT_BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET'] },
  { kind: 'var', label: 'Google OAuth client id', names: ['GOOGLE_CLIENT_ID'] },
  { kind: 'secret', label: 'Google OAuth client secret', names: ['GOOGLE_CLIENT_SECRET'] },
  { kind: 'var', label: 'Convex deployment URL', names: ['CONVEX_URL', 'NUXT_PUBLIC_CONVEX_URL'] },
  { kind: 'var', label: 'Cloudflare account id', names: ['CF_ACCOUNT_ID'] },
  { kind: 'var', label: 'Cloudflare AI Gateway id', names: ['CLOUDFLARE_AI_GATEWAY_ID'] },
  { kind: 'secret', label: 'Cloudflare AI Gateway API key', names: ['CLOUDFLARE_AI_GATEWAY_API_KEY'] },
  { kind: 'var', label: 'Cloudflare AI Search instance', names: ['CLOUDFLARE_AI_SEARCH_INSTANCE'] },
  { kind: 'secret', label: 'Cloudflare AI Search token', names: ['CLOUDFLARE_AI_SEARCH_TOKEN'] },
  { kind: 'secret', label: 'OpenRouter API key', names: ['OPENROUTER_API_KEY'] },
  { kind: 'var', label: 'R2 bucket name', names: ['R2_BUCKET_NAME'] },
  { kind: 'var', label: 'R2 endpoint', names: ['R2_ENDPOINT'] },
  { kind: 'secret', label: 'R2 access key id', names: ['R2_ACCESS_KEY_ID'] },
  { kind: 'secret', label: 'R2 secret access key', names: ['R2_SECRET_ACCESS_KEY'] },
]

function formatNames(names) {
  return names.length === 1 ? names[0] : names.join(' or ')
}

const missing = requirements.filter(({ names }) => !names.some((name) => {
  const value = mergedEnv[name]
  return typeof value === 'string' && value.trim().length > 0
}))

const betterAuthSecret = mergedEnv.NUXT_BETTER_AUTH_SECRET || mergedEnv.BETTER_AUTH_SECRET || ''
const invalid = []

if (betterAuthSecret && betterAuthSecret.length < 32) {
  invalid.push({
    kind: 'secret',
    label: 'Better Auth secret must be at least 32 characters',
    names: ['NUXT_BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET'],
  })
}

if (missing.length === 0 && invalid.length === 0) {
  process.exit(0)
}

const lines = [
  '',
  `[budds env] Missing required environment configuration for ${phase}.`,
  '[budds env] Set these in Cloudflare Pages: Settings > Variables and Secrets.',
  '[budds env] Use encrypted Secrets for sensitive values and plain Variables for non-sensitive values.',
]

if (missing.length > 0) {
  lines.push('')
  lines.push('Missing:')
  for (const entry of missing) {
    lines.push(`- [${entry.kind}] ${entry.label}: ${formatNames(entry.names)}`)
  }
}

if (invalid.length > 0) {
  lines.push('')
  lines.push('Invalid:')
  for (const entry of invalid) {
    lines.push(`- [${entry.kind}] ${entry.label}: ${formatNames(entry.names)}`)
  }
}

lines.push('')
lines.push('Example split:')
lines.push('- Secrets: BETTER_AUTH_SECRET, GOOGLE_CLIENT_SECRET, CLOUDFLARE_AI_GATEWAY_API_KEY, CLOUDFLARE_AI_SEARCH_TOKEN, OPENROUTER_API_KEY, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY')
lines.push('- Variables: GOOGLE_CLIENT_ID, CONVEX_URL, CF_ACCOUNT_ID, CLOUDFLARE_AI_GATEWAY_ID, CLOUDFLARE_AI_SEARCH_INSTANCE, R2_BUCKET_NAME, R2_ENDPOINT')
lines.push('')

const output = `${lines.join('\n')}\n`

if (strict) {
  process.stderr.write(output)
  process.exit(1)
}

process.stderr.write(`${output}[budds env] Continuing because strict validation is off.\n`)
