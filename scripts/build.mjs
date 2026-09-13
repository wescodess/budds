import { spawnSync } from 'node:child_process'
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

const secretEnvironmentNameSet = new Set(secretEnvironmentNames)
const buildEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !secretEnvironmentNameSet.has(name)),
)

const nuxtCli = path.resolve('node_modules/nuxt/bin/nuxt.mjs')
const result = spawnSync(process.execPath, [nuxtCli, 'build', '--dotenv', '/dev/null'], {
  cwd: process.cwd(),
  env: buildEnvironment,
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
