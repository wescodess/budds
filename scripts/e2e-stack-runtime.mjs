import { once } from 'node:events'
import { connect } from 'node:net'

export const supportsProcessGroups = process.platform !== 'win32'

export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  const signal = name => {
    try {
      if (supportsProcessGroups) process.kill(-child.pid, name)
      else child.kill(name)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  // Convex runs its backend cleanup on SIGINT.
  signal('SIGINT')
  const force = setTimeout(() => signal('SIGKILL'), 30_000)
  try { await closed } finally { clearTimeout(force) }
}

export async function waitForPortsClosed(ports) {
  const listening = port => new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = value => { socket.destroy(); resolve(value) }
    socket.once('connect', () => finish(true))
    socket.once('error', error => finish(error.code !== 'ECONNREFUSED'))
    socket.setTimeout(1000, () => finish(true))
  })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if ((await Promise.all(ports.map(listening))).every(value => !value)) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Disposable Convex did not release ports ${ports.join(', ')} after shutdown`)
}

export function redactStartupOutput(value, secrets) {
  let output = String(value)
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) output = output.replaceAll(secret, '[REDACTED]')
  return output.replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED]')
}

export async function ensureDisposableLearner(siteUrl, appUrl, learner) {
  const request = async action => {
    const response = await fetch(`${siteUrl}/api/auth/${action}/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: appUrl }, body: JSON.stringify(learner),
    })
    const account = await response.json().catch(() => ({}))
    return { response, account }
  }
  let { response, account } = await request('sign-in')
  if (!response.ok && account.code === 'INVALID_EMAIL_OR_PASSWORD') {
    const signup = await request('sign-up')
    if (signup.response.ok || ['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'].includes(signup.account.code)) {
      ;({ response, account } = await request('sign-in'))
    } else {
      ;({ response, account } = signup)
    }
  }
  if (!response.ok) {
    const code = typeof account.code === 'string' && /^[A-Z_]{1,80}$/.test(account.code) ? ` (${account.code})` : ''
    throw new Error(`Disposable learner authentication failed: HTTP ${response.status}${code}`)
  }
  if (typeof account.user?.id !== 'string' || !account.user.id || account.user.id.includes('|')) throw new Error('Disposable learner has no valid auth subject')
  return account.user.id
}
