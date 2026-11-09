import { existsSync } from 'node:fs'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import dgram from 'node:dgram'
import { fileURLToPath } from 'node:url'

// Node 24 strips types. Resolve only relative, extensionless repository imports;
// the scorer modules remain the implementation, without a copied JS build.
export function registerScorerImports() {
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 is required')
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[a-z]+$/i.test(specifier)) {
        const url = new URL(`${specifier}.ts`, context.parentURL)
        if (existsSync(fileURLToPath(url))) return next(url.href, context)
      }
      return next(specifier, context)
    },
  })
}

export function forbidNetwork() {
  const deny = () => { throw new Error('offline_contract_only: network is forbidden') }
  globalThis.fetch = deny
  for (const [module, methods] of [[http, ['request', 'get']], [https, ['request', 'get']],
    [net, ['connect', 'createConnection']], [tls, ['connect']], [dgram, ['createSocket']]]) {
    for (const method of methods) module[method] = deny
  }
  net.Socket.prototype.connect = deny
  syncBuiltinESMExports()
}
