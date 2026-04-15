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
const wranglerPath = path.join(projectRoot, 'wrangler.toml')

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

function parseWranglerVars(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const source = fs.readFileSync(filePath, 'utf8')
  const entries = {}
  let currentSection = ''

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]?.trim() || ''
      continue
    }

    if (currentSection !== 'vars') continue

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
  ...parseWranglerVars(wranglerPath),
  ...process.env,
}

const blockingRequirements = [
  { kind: 'secret', label: 'Better Auth secret', names: ['NUXT_BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET'] },
  { kind: 'var', label: 'Convex deployment URL', names: ['CONVEX_URL', 'NUXT_PUBLIC_CONVEX_URL'] },
]

const advisoryRequirements = [
  { kind: 'var', label: 'Google OAuth client id', names: ['GOOGLE_CLIENT_ID'] },
  { kind: 'secret', label: 'Google OAuth client secret', names: ['GOOGLE_CLIENT_SECRET'] },
  { kind: 'var', label: 'Cloudflare account id', names: ['CF_ACCOUNT_ID', 'NUXT_CLOUDFLARE_ACCOUNT_ID'] },
  { kind: 'var', label: 'Cloudflare AI Gateway id', names: ['CLOUDFLARE_AI_GATEWAY_ID', 'NUXT_CLOUDFLARE_AI_GATEWAY_ID'] },
  { kind: 'secret', label: 'Cloudflare AI Gateway API key', names: ['CLOUDFLARE_AI_GATEWAY_API_KEY', 'NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY'] },
  { kind: 'var', label: 'Cloudflare AI Search instance', names: ['CLOUDFLARE_AI_SEARCH_INSTANCE', 'NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE'] },
  { kind: 'secret', label: 'Cloudflare AI Search token', names: ['CLOUDFLARE_AI_SEARCH_TOKEN', 'NUXT_CLOUDFLARE_AI_SEARCH_TOKEN'] },
  { kind: 'secret', label: 'OpenRouter API key', names: ['OPENROUTER_API_KEY', 'NUXT_OPENROUTER_API_KEY'] },
  { kind: 'var', label: 'R2 bucket name', names: ['R2_BUCKET_NAME', 'NUXT_R2_BUCKET_NAME'] },
  { kind: 'var', label: 'R2 endpoint', names: ['R2_ENDPOINT', 'NUXT_R2_ENDPOINT'] },
  { kind: 'secret', label: 'R2 access key id', names: ['R2_ACCESS_KEY_ID', 'NUXT_R2_ACCESS_KEY_ID'] },
  { kind: 'secret', label: 'R2 secret access key', names: ['R2_SECRET_ACCESS_KEY', 'NUXT_R2_SECRET_ACCESS_KEY'] },
]

function formatNames(names) {
  return names.length === 1 ? names[0] : names.join(' or ')
}

function findMissing(requirements) {
  return requirements.filter(({ names }) => !names.some((name) => {
    const value = mergedEnv[name]
    return typeof value === 'string' && value.trim().length > 0
  }))
}

const missingBlocking = findMissing(blockingRequirements)
const missingAdvisory = findMissing(advisoryRequirements)

const betterAuthSecret = mergedEnv.NUXT_BETTER_AUTH_SECRET || mergedEnv.BETTER_AUTH_SECRET || ''
const invalidBlocking = []

if (betterAuthSecret && betterAuthSecret.length < 32) {
  invalidBlocking.push({
    kind: 'secret',
    label: 'Better Auth secret must be at least 32 characters',
    names: ['NUXT_BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET'],
  })
}

if (missingBlocking.length === 0 && invalidBlocking.length === 0 && missingAdvisory.length === 0) {
  process.exit(0)
}

const lines = ['']

if (missingBlocking.length > 0 || invalidBlocking.length > 0) {
  lines.push(`[budds env] Missing required environment configuration for ${phase}.`)
  lines.push('[budds env] Set these in Cloudflare Pages: Settings > Variables and Secrets.')
  lines.push('[budds env] Use encrypted Secrets for sensitive values and plain Variables for non-sensitive values.')
} else if (missingAdvisory.length > 0) {
  lines.push(`[budds env] Optional runtime environment variables are missing for ${phase}.`)
  lines.push('[budds env] Build can continue, but related runtime features may fail if these are not configured in Cloudflare Pages.')
}

if (missingBlocking.length > 0) {
  lines.push('')
  lines.push('Missing required:')
  for (const entry of missingBlocking) {
    lines.push(`- [${entry.kind}] ${entry.label}: ${formatNames(entry.names)}`)
  }
}

if (invalidBlocking.length > 0) {
  lines.push('')
  lines.push('Invalid required:')
  for (const entry of invalidBlocking) {
    lines.push(`- [${entry.kind}] ${entry.label}: ${formatNames(entry.names)}`)
  }
}

if (missingAdvisory.length > 0) {
  lines.push('')
  lines.push('Missing runtime-only:')
  for (const entry of missingAdvisory) {
    lines.push(`- [${entry.kind}] ${entry.label}: ${formatNames(entry.names)}`)
  }
}

lines.push('')
lines.push('Recommended split for Cloudflare Pages (Settings > Variables and Secrets):')
lines.push('- Secrets: BETTER_AUTH_SECRET, GOOGLE_CLIENT_SECRET, NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY, NUXT_CLOUDFLARE_AI_SEARCH_TOKEN, NUXT_OPENROUTER_API_KEY, NUXT_R2_ACCESS_KEY_ID, NUXT_R2_SECRET_ACCESS_KEY')
lines.push('- Variables in wrangler.toml [vars]: GOOGLE_CLIENT_ID, NUXT_CLOUDFLARE_ACCOUNT_ID, NUXT_CLOUDFLARE_AI_GATEWAY_ID, NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE, NUXT_R2_BUCKET_NAME, NUXT_R2_ENDPOINT')
lines.push('- Local dev: set CONVEX_URL in .env.local (NUXT_PUBLIC_CONVEX_URL is optional because the app falls back to CONVEX_URL)')
lines.push('- Cloudflare Pages preview: set CONVEX_URL and NUXT_PUBLIC_CONVEX_URL to https://cautious-elephant-39.convex.cloud')
lines.push('- Cloudflare Pages production: set CONVEX_URL and NUXT_PUBLIC_CONVEX_URL to https://trustworthy-mink-186.convex.cloud')
lines.push('- Do not set NUXT_CONVEX_SITE_URL separately; the app derives it from CONVEX_URL')
lines.push('')

const output = `${lines.join('\n')}\n`

if (strict && (missingBlocking.length > 0 || invalidBlocking.length > 0)) {
  process.stderr.write(output)
  process.exit(1)
}

if (missingAdvisory.length > 0 || missingBlocking.length > 0 || invalidBlocking.length > 0) {
  process.stderr.write(output)
}

if (!strict && (missingBlocking.length > 0 || invalidBlocking.length > 0)) {
  process.stderr.write('[budds env] Continuing because strict validation is off.\n')
}
