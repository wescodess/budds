import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnOwnedChild } from '../../scripts/e2e-stack-runtime.mjs'

const [mode, directory] = process.argv.slice(2)
if (mode === 'parent') {
  const owner = spawnOwnedChild(process.execPath, [fileURLToPath(import.meta.url), 'backend', directory])
  owner.stdout.resume()
  owner.stderr.resume()
  await writeFile(join(directory, 'owner.json'), JSON.stringify({ pid: owner.pid }))
} else if (mode === 'backend') {
  // This fixture must survive broken output pipes so only the owner's force
  // shutdown can release the listener after its parent is killed.
  process.stdout.on('error', () => {})
  process.stderr.on('error', () => {})
  process.on('SIGINT', () => {
    writeFileSync(join(directory, 'sigint'), '')
    setTimeout(() => {
      process.stdout.write('late stdout diagnostic\n')
      process.stderr.write('late stderr diagnostic\n')
      writeFileSync(join(directory, 'write-attempted'), '')
    }, 100)
  })
  const server = createServer((request, response) => {
    response.end('alive', () => { if (request.url === '/stop') process.exit(0) })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  await writeFile(join(directory, 'backend.json'), JSON.stringify({ pid: process.pid, port: server.address().port }))
} else throw new Error('Expected parent or backend fixture mode')
