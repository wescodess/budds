import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import base from '../vitest.config'

const devPin = '58d2ae62238a86b60ce467716c121e6829813fcd'
const pin = process.env.C4_PARITY_IMPLEMENTATION_PIN || devPin
const root = fileURLToPath(new URL('../', import.meta.url))
const files = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', pin], { cwd: root, encoding: 'utf8' }).trim().split('\n'))
export default defineConfig({
  ...base,
  plugins: [{ name: 'pinned-dev-handlers', enforce: 'pre', load(id) {
    if (!id.startsWith(root)) return
    const path = id.split('?')[0]!.slice(root.length)
    if (!/^(convex|server|shared|workers|app)\//.test(path) || /\.test\./.test(path) || path === 'convex/schema.ts' || !files.has(path)) return
    return execFileSync('git', ['show', `${pin}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 4_000_000 })
  } }],
  test: { ...base.test, silent: false, disableConsoleIntercept: true, env: { C4_RECORD_DEV: pin === devPin ? devPin : '' }, include: ['convex/learnV2DisclosureOffParity.test.ts', 'server/api/disclosure-off-parity.test.ts'], maxWorkers: 1 },
})
