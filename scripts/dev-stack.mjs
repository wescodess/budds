import { spawn } from 'node:child_process'

const projectRoot = process.cwd()
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const supportsProcessGroups = process.platform !== 'win32'
const children = new Set()
let exiting = false

function start(label, args) {
  const child = spawn(pnpmCommand, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    detached: supportsProcessGroups,
  })
  children.add(child)
  child.once('error', (error) => {
    process.stderr.write(`[budds dev:stack] ${label} failed to start: ${error.message}\n`)
    shutdown(1)
  })
  child.once('exit', (code, signal) => {
    children.delete(child)
    if (!exiting) {
      process.stderr.write(`[budds dev:stack] ${label} exited (${signal ?? code ?? 'unknown'}).\n`)
      shutdown(code ?? 1)
    }
  })
}

function signalChildTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    if (supportsProcessGroups && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  }
  catch (error) {
    if (error?.code !== 'ESRCH') {
      process.stderr.write(
        `[budds dev:stack] Failed to send ${signal} to process ${child.pid ?? 'unknown'}: ${error.message}\n`,
      )
    }
  }
}

function shutdown(exitCode = 0) {
  if (exiting) return
  exiting = true
  const pendingChildren = [...children]
  const exits = pendingChildren.map(child => new Promise(resolve => child.once('exit', resolve)))
  for (const child of pendingChildren) signalChildTree(child, 'SIGTERM')
  const forceTimer = setTimeout(() => {
    for (const child of children) signalChildTree(child, 'SIGKILL')
    process.exit(exitCode)
  }, 5_000)
  forceTimer.unref()
  Promise.all(exits)
    .finally(() => process.exit(exitCode))
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

process.stdout.write('[budds dev:stack] Starting Nuxt, Convex, and the Audio Workflow Worker.\n')
start('Nuxt', ['dev'])
start('Convex', ['exec', 'convex', 'dev'])
start('Audio Workflow Worker', ['audio:workflow:dev'])
