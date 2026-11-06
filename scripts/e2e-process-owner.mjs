import { execFile, spawn } from 'node:child_process'

// This detached group leader stays alive even if the command exits first.
// Only it signals its own group, so a recycled launcher PID is never targeted.
let stopping = false
const finish = () => process.kill(0, 'SIGKILL')
const inspectGroup = () => {
  // Darwin selects this group; Linux selects its detached session. Include
  // PGID and filter it explicitly. Never enumerate the host's process table.
  const query = execFile('/bin/ps', ['-o', 'pid=,pgid=', '-g', String(process.pid)], { timeout: 1000, maxBuffer: 64 * 1024 }, (error, stdout) => {
    if (!error) {
      const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/u).map(Number))
      const valid = rows.every(row => row.length === 2 && row.every(value => Number.isSafeInteger(value) && value > 0))
      const members = rows.filter(([, group]) => group === process.pid).map(([pid]) => pid)
      if (valid && members.includes(process.pid) && members.every(pid => pid === process.pid || pid === query.pid)) finish()
    }
    // Failed or unsupported inspection keeps the full grace period; only the
    // still-running owner can issue the final signal to its own group.
    setTimeout(inspectGroup, 250)
  })
}
const stop = () => {
  if (stopping) return
  stopping = true
  // Convex runs its backend cleanup on SIGINT.
  process.kill(0, 'SIGINT')
  setTimeout(finish, 30_000)
  inspectGroup()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('disconnect', stop)
process.on('message', message => { if (message === 'stop') stop() })

const report = message => { if (process.connected) process.send(message, () => {}) }
const command = spawn(process.argv[2], process.argv.slice(3), { stdio: ['ignore', 'pipe', 'pipe'] })
for (const [source, destination] of [[command.stdout, process.stdout], [command.stderr, process.stderr]]) {
  destination.on('error', () => {
    // Broken parent pipes must not cancel shutdown. Drain until force runs.
    source.unpipe(destination)
    source.resume()
    stop()
  })
  source.pipe(destination)
}
command.once('error', error => report({ type: 'commandError', message: error.message }))
command.once('exit', (code, signal) => report({ type: 'commandExit', code, signal }))
