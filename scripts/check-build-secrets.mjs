import fs from 'node:fs'
import path from 'node:path'

const secretEnvironmentNames = [
  'AUDIO_OVERVIEW_JOB_SECRET',
  'AUDIO_OVERVIEW_WORKER_TOKEN',
  'BETTER_AUTH_SECRET',
  'CALENDAR_TOKEN_ENCRYPTION_KEY',
  'CLOUDFLARE_AI_GATEWAY_API_KEY',
  'CLOUDFLARE_AI_SEARCH_TOKEN',
  'CLOUDFLARE_WORKERS_AI_TOKEN',
  'DIA_SERVER_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'NUXT_AUDIO_OVERVIEW_JOB_SECRET',
  'NUXT_AUDIO_OVERVIEW_WORKER_TOKEN',
  'NUXT_BETTER_AUTH_SECRET',
  'NUXT_CALENDAR_TOKEN_ENCRYPTION_KEY',
  'NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY',
  'NUXT_CLOUDFLARE_AI_SEARCH_TOKEN',
  'NUXT_CLOUDFLARE_WORKERS_AI_TOKEN',
  'NUXT_DIA_SERVER_API_KEY',
  'NUXT_OPENROUTER_API_KEY',
  'NUXT_R2_ACCESS_KEY_ID',
  'NUXT_R2_SECRET_ACCESS_KEY',
  'OPENROUTER_API_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
]

function parseDotenvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const entries = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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

const configuredValues = {
  ...parseDotenvFile('.env'),
  ...parseDotenvFile('.env.local'),
  ...parseDotenvFile('.env.audio-workflow.local'),
  ...parseDotenvFile('workers/audio-overview/.dev.vars'),
  ...process.env,
}

const secrets = secretEnvironmentNames
  .map(name => ({ name, value: configuredValues[name] }))
  .filter(entry => typeof entry.value === 'string' && entry.value.length >= 8)

const outputDirectory = path.resolve('dist')
if (!fs.existsSync(outputDirectory)) {
  throw new Error('Build output is missing; run the production build before scanning it')
}

const outputFiles = []
function collectFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectFiles(filePath)
    else outputFiles.push(filePath)
  }
}
collectFiles(outputDirectory)

const findings = []
for (const outputFile of outputFiles) {
  const contents = fs.readFileSync(outputFile)
  for (const secret of secrets) {
    if (contents.includes(Buffer.from(secret.value))) {
      findings.push(`${secret.name} in ${path.relative(process.cwd(), outputFile)}`)
    }
  }
}

if (findings.length > 0) {
  process.stderr.write('[budds build] Secret values were embedded in the build output:\n')
  for (const finding of findings) process.stderr.write(`- ${finding}\n`)
  process.exit(1)
}

process.stdout.write(`[budds build] Secret scan passed (${outputFiles.length} files, ${secrets.length} configured values).\n`)
