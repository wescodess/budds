import fs from 'node:fs'
import path from 'node:path'

const phase = process.argv[2] || 'build'
const audioWorkflowPhase = phase === 'audio-workflow'
const strict = process.argv.includes('--strict')
  || Boolean(process.env.CF_PAGES)
  || Boolean(process.env.CI)

const projectRoot = process.cwd()
const dotenvPaths = [
  path.join(projectRoot, '.env'),
  path.join(projectRoot, '.env.local'),
  ...(audioWorkflowPhase ? [path.join(projectRoot, 'workers/audio-overview/.dev.vars')] : []),
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

const pagesBlockingRequirements = [
  { kind: 'secret', label: 'Better Auth secret', names: ['NUXT_BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET'] },
  { kind: 'var', label: 'Convex deployment URL', names: ['CONVEX_URL', 'NUXT_PUBLIC_CONVEX_URL'] },
  { kind: 'var', label: 'Public application origin', names: ['SITE_URL', 'NUXT_PUBLIC_SITE_URL', 'CF_PAGES_URL'] },
  { kind: 'var', label: 'Google OAuth client id', names: ['GOOGLE_CLIENT_ID'] },
  { kind: 'secret', label: 'Google OAuth client secret', names: ['GOOGLE_CLIENT_SECRET'] },
  { kind: 'secret', label: 'Audio Overview job secret', names: ['AUDIO_OVERVIEW_JOB_SECRET', 'NUXT_AUDIO_OVERVIEW_JOB_SECRET'] },
  { kind: 'secret', label: 'Audio Overview Workflow launch token', names: ['AUDIO_OVERVIEW_WORKER_TOKEN', 'NUXT_AUDIO_OVERVIEW_WORKER_TOKEN'] },
  { kind: 'secret', label: 'Calendar token encryption key', names: ['CALENDAR_TOKEN_ENCRYPTION_KEY', 'NUXT_CALENDAR_TOKEN_ENCRYPTION_KEY'] },
]

const workerBlockingRequirements = [
  { kind: 'secret', label: 'Audio Overview Workflow launch token', names: ['AUDIO_OVERVIEW_WORKER_TOKEN'] },
  { kind: 'secret', label: 'Gemini Audio Renderer API key', names: ['GEMINI_API_KEY'] },
  { kind: 'var', label: 'Pages callback origin', names: ['PAGES_BASE_URL'] },
]

const pagesAdvisoryRequirements = [
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

const blockingRequirements = audioWorkflowPhase ? workerBlockingRequirements : pagesBlockingRequirements
const advisoryRequirements = audioWorkflowPhase ? [] : pagesAdvisoryRequirements

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
const audioOverviewWorkerToken
  = mergedEnv.NUXT_AUDIO_OVERVIEW_WORKER_TOKEN || mergedEnv.AUDIO_OVERVIEW_WORKER_TOKEN || ''
const calendarTokenEncryptionKey
  = mergedEnv.NUXT_CALENDAR_TOKEN_ENCRYPTION_KEY || mergedEnv.CALENDAR_TOKEN_ENCRYPTION_KEY || ''
const invalidBlocking = []

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && Boolean(url.hostname)
  }
  catch {
    return false
  }
}

if (!audioWorkflowPhase) {
  const siteUrl = mergedEnv.SITE_URL || mergedEnv.NUXT_PUBLIC_SITE_URL || ''
  const convexUrl = mergedEnv.NUXT_PUBLIC_CONVEX_URL || mergedEnv.CONVEX_URL || ''
  if (siteUrl && !isHttpUrl(siteUrl)) {
    invalidBlocking.push({
      kind: 'var',
      label: 'Public application origin must be an HTTP(S) URL',
      names: ['SITE_URL', 'NUXT_PUBLIC_SITE_URL'],
    })
  }
  if (convexUrl && !isHttpUrl(convexUrl)) {
    invalidBlocking.push({
      kind: 'var',
      label: 'Convex deployment URL must be an HTTP(S) URL',
      names: ['CONVEX_URL', 'NUXT_PUBLIC_CONVEX_URL'],
    })
  }
}

if (!audioWorkflowPhase && betterAuthSecret && betterAuthSecret.length < 32) {
  invalidBlocking.push({
    kind: 'secret',
    label: 'Better Auth secret must be at least 32 characters',
    names: ['NUXT_BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET'],
  })
}

if (audioOverviewWorkerToken && audioOverviewWorkerToken.length < 32) {
  invalidBlocking.push({
    kind: 'secret',
    label: 'Audio Overview orchestration credential must be at least 32 characters',
    names: audioWorkflowPhase
      ? ['AUDIO_OVERVIEW_WORKER_TOKEN']
      : ['NUXT_AUDIO_OVERVIEW_WORKER_TOKEN', 'AUDIO_OVERVIEW_WORKER_TOKEN'],
  })
}

if (!audioWorkflowPhase && calendarTokenEncryptionKey) {
  let keyBytes = 0
  try {
    keyBytes = Buffer.from(calendarTokenEncryptionKey, 'base64').byteLength
  }
  catch {
    keyBytes = 0
  }
  if (keyBytes !== 32) {
    invalidBlocking.push({
      kind: 'secret',
      label: 'Calendar token encryption key must be Base64-encoded 32 bytes',
      names: ['NUXT_CALENDAR_TOKEN_ENCRYPTION_KEY', 'CALENDAR_TOKEN_ENCRYPTION_KEY'],
    })
  }
}

if (audioWorkflowPhase) {
  const geminiApiKey = mergedEnv.GEMINI_API_KEY || ''
  if (/^(?:ya29\.|Bearer\s+)/i.test(geminiApiKey.trim())) {
    invalidBlocking.push({
      kind: 'secret',
      label: 'Gemini credential must be a Google AI Studio API key, not an OAuth access token',
      names: ['GEMINI_API_KEY'],
    })
  }
  const workerConfigPath = path.join(projectRoot, 'workers/audio-overview/wrangler.jsonc')
  const workerConfig = fs.existsSync(workerConfigPath) ? fs.readFileSync(workerConfigPath, 'utf8') : ''
  const requiredBindings = [
    ['AUDIO_ARTIFACTS', 'Private Audio Artifact R2 binding'],
    ['AI', 'Workers AI transcription binding'],
    ['AUDIO_OVERVIEW_WORKFLOW', 'Durable Audio Overview Workflow binding'],
  ]
  for (const [binding, label] of requiredBindings) {
    if (new RegExp(`"binding"\\s*:\\s*"${binding}"`).test(workerConfig)) continue
    invalidBlocking.push({ kind: 'binding', label: `${label} is missing from the Worker config`, names: [binding] })
  }
  const pagesBaseUrl = mergedEnv.PAGES_BASE_URL || ''
  try {
    const parsed = new URL(pagesBaseUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
  }
  catch {
    if (pagesBaseUrl) {
      invalidBlocking.push({ kind: 'var', label: 'Pages callback origin must be an HTTP(S) URL', names: ['PAGES_BASE_URL'] })
    }
  }
}

if (missingBlocking.length === 0 && invalidBlocking.length === 0 && missingAdvisory.length === 0) {
  process.exit(0)
}

const lines = ['']

if (missingBlocking.length > 0 || invalidBlocking.length > 0) {
  lines.push(`[budds env] Missing required environment configuration for ${phase}.`)
  lines.push(audioWorkflowPhase
    ? '[budds env] Set secrets and variables on the Audio Overview Workflow Worker.'
    : '[budds env] Set these in Cloudflare Pages: Settings > Variables and Secrets.')
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
if (audioWorkflowPhase) {
  lines.push('Required split for the Audio Overview Workflow Worker:')
  lines.push('- Local .dev.vars secrets: AUDIO_OVERVIEW_WORKER_TOKEN, GEMINI_API_KEY')
  lines.push('- Worker production secrets: AUDIO_OVERVIEW_WORKER_TOKEN, GEMINI_API_KEY')
  lines.push('- Convex deployment secret mirror: AUDIO_OVERVIEW_WORKER_TOKEN must exactly match the Worker and Nuxt value')
  lines.push('- Worker variable: PAGES_BASE_URL')
  lines.push('- Worker private R2 binding: AUDIO_ARTIFACTS')
  lines.push('- Worker AI binding: AI')
  lines.push('- Worker durable Workflow binding: AUDIO_OVERVIEW_WORKFLOW')
  lines.push('- Never place GEMINI_API_KEY in Nuxt public runtime config or Workflow parameters')
}
else {
  lines.push('Recommended split for Cloudflare Pages (Settings > Variables and Secrets):')
  lines.push('- Local dev (.env.local): CONVEX_URL, GOOGLE_CLIENT_ID, NUXT_PUBLIC_SITE_URL, NUXT_CLOUDFLARE_AI_GATEWAY_ID, NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE, NUXT_R2_BUCKET_NAME, NUXT_R2_ENDPOINT, NUXT_AUDIO_OVERVIEW_WORKER_URL')
  lines.push('- Cloudflare Pages Variables: CONVEX_URL, NUXT_PUBLIC_CONVEX_URL, GOOGLE_CLIENT_ID, NUXT_PUBLIC_SITE_URL, NUXT_CLOUDFLARE_ACCOUNT_ID, NUXT_CLOUDFLARE_AI_GATEWAY_ID, NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE, NUXT_R2_BUCKET_NAME, NUXT_R2_ENDPOINT')
  lines.push('- Cloudflare Pages Secrets: NUXT_BETTER_AUTH_SECRET, GOOGLE_CLIENT_SECRET, CALENDAR_TOKEN_ENCRYPTION_KEY, NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY, NUXT_CLOUDFLARE_AI_SEARCH_TOKEN, NUXT_OPENROUTER_API_KEY, NUXT_R2_ACCESS_KEY_ID, NUXT_R2_SECRET_ACCESS_KEY, NUXT_AUDIO_OVERVIEW_JOB_SECRET, NUXT_AUDIO_OVERVIEW_WORKER_TOKEN')
  lines.push('- Convex deployment Secrets: CALENDAR_TOKEN_ENCRYPTION_KEY must match Pages; AUDIO_OVERVIEW_WORKER_TOKEN must match NUXT_AUDIO_OVERVIEW_WORKER_TOKEN')
  lines.push('- Cloudflare Pages preview Convex URL: https://cautious-elephant-39.convex.cloud')
  lines.push('- Cloudflare Pages production Convex URL: https://trustworthy-mink-186.convex.cloud')
  lines.push('- Do not set NUXT_CONVEX_SITE_URL separately; the app derives it from CONVEX_URL')
}
lines.push('')

const output = `${lines.join('\n')}\n`

if (strict && (missingBlocking.length > 0 || invalidBlocking.length > 0)) {
  process.stderr.write(output)
  const blockers = [
    ...missingBlocking.map((entry) => formatNames(entry.names)),
    ...invalidBlocking.map((entry) => formatNames(entry.names)),
  ]
  process.stderr.write(`[budds env] Build blocked by: ${blockers.join(', ')}\n`)
  process.exit(1)
}

if (missingAdvisory.length > 0 || missingBlocking.length > 0 || invalidBlocking.length > 0) {
  process.stderr.write(output)
}

if (!strict && (missingBlocking.length > 0 || invalidBlocking.length > 0)) {
  process.stderr.write('[budds env] Continuing because strict validation is off.\n')
}
