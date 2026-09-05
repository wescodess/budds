import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const projectRoot = process.cwd()
const audioEnvPath = path.join(projectRoot, '.env.audio-workflow.local')
const audioEnvironmentNames = [
  'NUXT_AUDIO_OVERVIEW_JOB_SECRET',
  'NUXT_AUDIO_OVERVIEW_WORKER_TOKEN',
  'NUXT_AUDIO_OVERVIEW_WORKER_URL',
]

if (fs.existsSync(audioEnvPath)) {
  process.loadEnvFile(audioEnvPath)
  process.stdout.write('[budds dev] Loaded local Audio Overview configuration.\n')
}

const missingAudioEnvironment = audioEnvironmentNames.filter(name => !process.env[name]?.trim())
if (missingAudioEnvironment.length > 0) {
  process.stderr.write(
    `[budds dev] Audio Overview is unavailable; missing ${missingAudioEnvironment.join(', ')}.\n`,
  )
}

if (process.env.BUDDS_DEV_ENV_CHECK_ONLY === '1') {
  process.exit(missingAudioEnvironment.length === 0 ? 0 : 1)
}

const nuxtCommand = process.platform === 'win32' ? 'nuxt.cmd' : 'nuxt'
const child = spawn(nuxtCommand, ['dev', ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
})

let stopping = false

function forwardSignal(signal) {
  if (stopping) return
  stopping = true
  if (child.exitCode === null && child.signalCode === null) child.kill(signal)
}

process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))

child.once('error', (error) => {
  process.stderr.write(`[budds dev] Failed to start Nuxt: ${error.message}\n`)
  process.exitCode = 1
})

child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
