import { createHash } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { BlockList, isIP } from 'node:net'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { promisify } from 'node:util'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { parseHTML } from 'linkedom/worker'

export const LEARN_V2_FETCH_POLICY_VERSION = 'learn-v2.fetch.v2'
export const LEARN_V2_RIGHTS_POLICY_VERSION = 'learn-v2.rights.v2'
export const LEARN_V2_ROBOTS_PRODUCT_TOKEN = 'budds-learn-v2'
export const MAX_SOURCE_URL_LENGTH = 2_048
export const MAX_REDIRECTS = 5
export const MAX_WIRE_BYTES = 2 * 1024 * 1024
export const MAX_DECODED_BYTES = 4 * 1024 * 1024
export const MAX_HTML_PARSE_BYTES = 512 * 1024
export const MAX_ROBOTS_BYTES = 512 * 1024
export const DEFAULT_DEADLINE_MS = 12_000
export const MAX_EXCERPT_CHARS = 4_000

export type SafeFetchReason =
  | 'invalid_url'
  | 'url_too_long'
  | 'https_required'
  | 'blocked_address'
  | 'dns_resolution_failed'
  | 'deadline_exceeded'
  | 'redirect_limit'
  | 'redirect_missing_location'
  | 'robots_denied'
  | 'robots_unavailable'
  | 'http_status'
  | 'partial_content'
  | 'authentication_required'
  | 'unsupported_mime'
  | 'unsupported_charset'
  | 'unsupported_encoding'
  | 'invalid_content_encoding'
  | 'content_signature_mismatch'
  | 'declared_size_overflow'
  | 'wire_size_overflow'
  | 'decoded_size_overflow'
  | 'binary_text'
  | 'network_failure'

export class SafeFetchError extends Error {
  readonly code: SafeFetchReason
  readonly retryable: boolean

  constructor(code: SafeFetchReason, retryable = false) {
    super(code)
    this.name = 'SafeFetchError'
    this.code = code
    this.retryable = code === 'deadline_exceeded' || retryable
  }
}

export type ResolvedAddress = { address: string, family: 4 | 6 }
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>

export type TransportResponse = IncomingMessage
export type PinnedTransport = (url: URL, deadlineAt: number) => Promise<TransportResponse>

const lookupAsync = promisify(dnsLookup)

export const resolveHostProduction: ResolveHost = async (hostname) => {
  try {
    const rows = await lookupAsync(hostname, { all: true, verbatim: true })
    return rows.map(row => ({ address: row.address, family: row.family as 4 | 6 }))
  }
  catch {
    throw new SafeFetchError('dns_resolution_failed', true)
  }
}

function normalizedHostname(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function parseIpv4(address: string): [number, number, number, number] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map(Number)
  return octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    ? octets as [number, number, number, number]
    : null
}

function isPublicIpv4(address: string) {
  const value = parseIpv4(address)
  if (!value) return false
  const [a, b, c] = value
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

const blockedIpv6 = new BlockList()
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:2::', 48],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) blockedIpv6.addSubnet(network, prefix, 'ipv6')

function isPublicIpv6(address: string) {
  const lower = address.toLowerCase().split('%')[0] ?? ''
  // Never treat an arbitrary dotted tail as authoritative for the enclosing
  // IPv6 address. In particular, fc00::8.8.8.8 and fe80::8.8.8.8 remain ULA
  // and link-local addresses. Only the explicitly recognized IPv4-mapped
  // representation delegates to the IPv4 policy.
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1]
  if (mapped) return isPublicIpv4(mapped)
  const firstHextet = Number.parseInt(lower.split(':')[0] ?? '', 16)
  // Public source fetching has no reason to admit IPv6 outside IANA's global
  // unicast 2000::/3 allocation. This keeps future or obscure special-use
  // ranges fail-closed rather than trying to enumerate the rest of ::/0.
  if (!Number.isFinite(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff) return false
  return !blockedIpv6.check(lower, 'ipv6')
}

export function isPublicAddress(address: string): boolean {
  const normalized = normalizedHostname(address)
  const family = isIP(normalized)
  return family === 4 ? isPublicIpv4(normalized) : family === 6 ? isPublicIpv6(normalized) : false
}

export function parseAndValidateSourceUrl(value: string, base?: URL): URL {
  if (value.length > MAX_SOURCE_URL_LENGTH) throw new SafeFetchError('url_too_long')
  let url: URL
  try {
    url = base ? new URL(value, base) : new URL(value)
  }
  catch {
    throw new SafeFetchError('invalid_url')
  }
  if (url.protocol !== 'https:') throw new SafeFetchError('https_required')
  if (url.username || url.password) throw new SafeFetchError('invalid_url')
  if (!url.hostname) throw new SafeFetchError('invalid_url')
  // A short relative Location can resolve against a long base into a URL that
  // exceeds the persisted/indexed boundary. Validate the serialized result,
  // not only the attacker-controlled input string.
  if (url.toString().length > MAX_SOURCE_URL_LENGTH) throw new SafeFetchError('url_too_long')
  return url
}

export function publicLocator(value: string): string {
  const url = parseAndValidateSourceUrl(value)
  // Paths can contain bearer capabilities and signed object identifiers. The
  // client-visible locator is intentionally origin-only.
  return `${url.origin}/`
}

export function canonicalSourceUrl(value: string): string {
  const url = parseAndValidateSourceUrl(value)
  url.hash = ''
  return url.toString()
}

type Clock = () => number

function assertDeadline(deadlineAt: number, now: Clock = Date.now) {
  if (now() >= deadlineAt) throw new SafeFetchError('deadline_exceeded')
}

function beforeDeadline<T>(operation: Promise<T>, deadlineAt: number, now: Clock = Date.now): Promise<T> {
  const remaining = deadlineAt - now()
  if (remaining <= 0) return Promise.reject(new SafeFetchError('deadline_exceeded'))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new SafeFetchError('deadline_exceeded'))
    }, remaining)
    // Both callbacks remain attached after timeout, so a resolver that rejects
    // late is observed and cannot become an unhandled rejection.
    operation.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function validateResolved(addresses: ResolvedAddress[], isAddressAllowed: (address: string) => boolean) {
  if (addresses.length === 0 || addresses.some(row => !isAddressAllowed(row.address))) {
    throw new SafeFetchError('blocked_address')
  }
}

export function createPinnedHttpsTransport(dependencies: {
  resolve?: ResolveHost
  request?: typeof httpsRequest
  isAddressAllowed?: (address: string) => boolean
  now?: Clock
} = {}): PinnedTransport {
  const resolve = dependencies.resolve ?? resolveHostProduction
  const request = dependencies.request ?? httpsRequest
  const isAddressAllowed = dependencies.isAddressAllowed ?? isPublicAddress
  const now = dependencies.now ?? Date.now
  return async (url, deadlineAt) => {
    assertDeadline(deadlineAt, now)
    const hostname = normalizedHostname(url.hostname)
    const literalFamily = isIP(hostname)
    const addresses = literalFamily
      ? [{ address: hostname, family: literalFamily as 4 | 6 }]
      : await beforeDeadline(resolve(hostname), deadlineAt, now)
    validateResolved(addresses, isAddressAllowed)
    assertDeadline(deadlineAt, now)

    const options: RequestOptions = {
      protocol: 'https:',
      hostname,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Accept: 'text/html, text/plain, application/pdf;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': `${LEARN_V2_ROBOTS_PRODUCT_TOKEN}/1.0`,
      },
      servername: literalFamily ? undefined : hostname,
      // A pooled socket could have been connected under an earlier DNS
      // decision. A request-local agent forces every hop through this lookup.
      agent: false,
      lookup: (_lookupHostname, optionsOrFamily, callback) => {
        const options = typeof optionsOrFamily === 'object' ? optionsOrFamily : { family: optionsOrFamily }
        const filtered = options.family === 4 || options.family === 6
          ? addresses.filter(row => row.family === options.family)
          : addresses
        if (filtered.length === 0) {
          callback(Object.assign(new Error('No validated address for requested family'), { code: 'ENOTFOUND' }), '', 4)
          return
        }
        if (options.all) {
          ;(callback as unknown as (error: null, addresses: ResolvedAddress[]) => void)(null, filtered)
          return
        }
        const selected = filtered[0]
        if (!selected) return
        callback(null, selected.address, selected.family)
      },
    }

    return await new Promise<IncomingMessage>((resolveResponse, reject) => {
      const timeout = Math.max(1, deadlineAt - now())
      let req: ReturnType<typeof httpsRequest>
      try {
        req = request(options, resolveResponse)
      }
      catch {
        reject(new SafeFetchError('network_failure', true))
        return
      }
      const timer = setTimeout(() => req.destroy(new SafeFetchError('deadline_exceeded')), timeout)
      req.once('error', (error) => {
        clearTimeout(timer)
        reject(error instanceof SafeFetchError ? error : new SafeFetchError('network_failure', true))
      })
      req.once('response', () => clearTimeout(timer))
      req.end()
    })
  }
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(', ') : value
}

function dispose(response: IncomingMessage) {
  if (!response.complete || !response.readableEnded) response.destroy()
}

async function collectWireBody(response: IncomingMessage, limit: number, deadlineAt: number, now: Clock = Date.now) {
  const parts: Buffer[] = []
  let size = 0
  const remaining = deadlineAt - now()
  if (remaining <= 0) {
    dispose(response)
    throw new SafeFetchError('deadline_exceeded')
  }
  let deadlineExpired = false
  const deadlineError = new SafeFetchError('deadline_exceeded')
  // The request timer ends at headers. This response-owned timer actively
  // aborts a peer that sends headers and then stalls forever.
  const timer = setTimeout(() => {
    deadlineExpired = true
    response.destroy(deadlineError)
  }, remaining)
  try {
    for await (const part of response) {
      assertDeadline(deadlineAt, now)
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
      size += chunk.length
      if (size > limit) throw new SafeFetchError('wire_size_overflow')
      parts.push(chunk)
    }
    assertDeadline(deadlineAt, now)
    if (!response.complete) throw new SafeFetchError('network_failure', true)
    return Buffer.concat(parts, size)
  }
  catch (error) {
    dispose(response)
    if (deadlineExpired || now() >= deadlineAt) throw deadlineError
    throw error instanceof SafeFetchError
      ? error
      : new SafeFetchError('network_failure', true)
  }
  finally {
    clearTimeout(timer)
  }
}

function decodeBody(body: Buffer, encoding: string | undefined, deadlineAt: number, maxDecodedBytes: number, now: Clock = Date.now) {
  assertDeadline(deadlineAt, now)
  let decoded: Buffer
  try {
    switch ((encoding ?? 'identity').trim().toLowerCase()) {
      case '':
      case 'identity': decoded = body; break
      case 'gzip': decoded = gunzipSync(body, { maxOutputLength: maxDecodedBytes + 1 }); break
      case 'deflate': decoded = inflateSync(body, { maxOutputLength: maxDecodedBytes + 1 }); break
      case 'br': decoded = brotliDecompressSync(body, { maxOutputLength: maxDecodedBytes + 1 }); break
      default: throw new SafeFetchError('unsupported_encoding')
    }
  }
  catch (error) {
    if (error instanceof SafeFetchError) throw error
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : ''
    throw new SafeFetchError(code === 'ERR_BUFFER_TOO_LARGE'
      ? 'decoded_size_overflow'
      : 'invalid_content_encoding')
  }
  assertDeadline(deadlineAt, now)
  if (decoded.length > maxDecodedBytes) throw new SafeFetchError('decoded_size_overflow')
  return decoded
}

function mediaTypeAndCharset(value: string | undefined) {
  const [rawType = '', ...parameters] = (value ?? '').split(';')
  const charsetParameter = parameters.map(value => value.trim()).find(value => /^charset\s*=/i.test(value))
  const charset = charsetParameter?.split('=')[1]?.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
  return { mediaType: rawType.trim().toLowerCase(), charset }
}

function decodeText(body: Buffer, charset: string | undefined, deadlineAt: number, now: Clock = Date.now) {
  if (charset && !['utf-8', 'utf8', 'us-ascii', 'ascii'].includes(charset)) {
    throw new SafeFetchError('unsupported_charset')
  }
  const nulCount = body.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0)
  const suspiciousControls = body.reduce((count, byte) => count + (byte < 9 || (byte > 13 && byte < 32) ? 1 : 0), 0)
  if (nulCount > 0 || suspiciousControls > Math.max(8, Math.floor(body.length / 100))) {
    throw new SafeFetchError('binary_text')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  }
  catch {
    throw new SafeFetchError('binary_text')
  }
  assertDeadline(deadlineAt, now)
  return text
}

function validateContentSignature(body: Buffer, mediaType: string) {
  const zip = body.length >= 4
    && body[0] === 0x50
    && body[1] === 0x4b
    && ((body[2] === 0x03 && body[3] === 0x04)
      || (body[2] === 0x05 && body[3] === 0x06)
      || (body[2] === 0x07 && body[3] === 0x08))
  const pdf = body.subarray(0, 5).equals(Buffer.from('%PDF-'))
  if (zip || (mediaType === 'application/pdf' ? !pdf : pdf)) {
    throw new SafeFetchError('content_signature_mismatch')
  }
}

type RobotsRule = { allow: boolean, pattern: string, length: number }

const UNRESERVED_OCTET = /^[A-Za-z0-9._~-]$/

// RFC 9309 compares URI octets after decoding percent-encoded unreserved
// characters. Reserved/non-ASCII octets stay escaped and hex is canonicalized
// so equivalent paths cannot disagree only by escape spelling.
function normalizeRobotsOctets(value: string) {
  const encoded = [...value].map((character) => {
    if (character.charCodeAt(0) <= 0x7f) return character
    return [...Buffer.from(character, 'utf8')]
      .map(octet => `%${octet.toString(16).padStart(2, '0').toUpperCase()}`)
      .join('')
  }).join('')
  return encoded.replace(/%([0-9a-fA-F]{2})/g, (match, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16))
    return UNRESERVED_OCTET.test(character) ? character : `%${hex.toUpperCase()}`
  })
}

function robotsPatternOctetLength(pattern: string) {
  const source = pattern.endsWith('$') ? pattern.slice(0, -1) : pattern
  let length = 0
  for (let index = 0; index < source.length;) {
    if (source[index] === '*') {
      index++
      continue
    }
    if (source[index] === '%' && /^[0-9A-F]{2}$/i.test(source.slice(index + 1, index + 3))) index += 3
    else index++
    length++
  }
  return length
}

function splitRobotsGroups(text: string) {
  const groups: Array<{ agents: string[], rules: RobotsRule[] }> = []
  let agents: string[] = []
  let rules: RobotsRule[] = []
  const flush = () => {
    if (agents.length) groups.push({ agents, rules })
    agents = []
    rules = []
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const name = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (name === 'user-agent') {
      if (rules.length) flush()
      agents.push(value.toLowerCase())
    }
    else if ((name === 'allow' || name === 'disallow') && agents.length && value) {
      const pattern = normalizeRobotsOctets(value)
      rules.push({ allow: name === 'allow', pattern, length: robotsPatternOctetLength(pattern) })
    }
  }
  flush()
  return groups
}

// Glob matching is dynamic-programmed: hostile wildcard rules cannot trigger
// regular-expression backtracking. `$` anchors the end as required by RFC 9309.
function robotsPatternMatches(pattern: string, path: string, work: { remaining: number }) {
  const anchored = pattern.endsWith('$')
  const source = anchored ? pattern.slice(0, -1) : pattern
  let states = new Set([0])
  for (let i = 0; i <= path.length; i++) {
    const expanded = new Set(states)
    let changed = true
    while (changed) {
      changed = false
      for (const state of [...expanded]) {
        if (--work.remaining < 0) return false
        if (source[state] === '*' && !expanded.has(state + 1)) {
          expanded.add(state + 1)
          changed = true
        }
      }
    }
    if ((!anchored || i === path.length) && expanded.has(source.length)) return true
    if (i === path.length) break
    const next = new Set<number>()
    for (const state of expanded) {
      if (--work.remaining < 0) return false
      if (source[state] === '*') next.add(state)
      else if (source[state] === path[i]) next.add(state + 1)
    }
    states = next
    if (states.size === 0) return false
  }
  return false
}

export function isRobotsAllowed(text: string, url: URL, productToken = LEARN_V2_ROBOTS_PRODUCT_TOKEN) {
  const groups = splitRobotsGroups(text)
  const token = productToken.toLowerCase()
  const exactGroups = groups.filter(group => group.agents.includes(token))
  const selected = exactGroups.length ? exactGroups : groups.filter(group => group.agents.includes('*'))
  if (selected.reduce((count, group) => count + group.rules.length, 0) > 4_096) return false
  const path = normalizeRobotsOctets(`${url.pathname}${url.search}` || '/')
  let winner: RobotsRule | undefined
  const work = { remaining: 2_000_000 }
  for (const group of selected) {
    for (const rule of group.rules) {
      if (!robotsPatternMatches(rule.pattern, path, work)) {
        if (work.remaining < 0) return false
        continue
      }
      if (!winner || rule.length > winner.length || (rule.length === winner.length && rule.allow && !winner.allow)) winner = rule
    }
  }
  return winner?.allow ?? true
}

function splitLinkHeader(value: string) {
  const results: string[] = []
  let start = 0
  let quoted = false
  let angled = false
  let escaped = false
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quoted && escaped) {
      escaped = false
      continue
    }
    if (quoted && char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '<') angled = true
    else if (!quoted && char === '>') angled = false
    else if (!quoted && !angled && char === ',') {
      results.push(value.slice(start, index))
      start = index + 1
    }
  }
  results.push(value.slice(start))
  return results
}

function linkParameters(value: string) {
  const parameters = new Map<string, string>()
  const target = value.match(/^\s*<[^>]*>/)
  if (!target) return parameters
  let cursor = target[0].length
  while (cursor < value.length) {
    while (/\s/.test(value[cursor] ?? '')) cursor++
    if (value[cursor] !== ';') break
    cursor++
    while (/\s/.test(value[cursor] ?? '')) cursor++
    const nameStart = cursor
    while (/[!#$%&'*+\-.^_`|~A-Za-z0-9]/.test(value[cursor] ?? '')) cursor++
    const name = value.slice(nameStart, cursor).toLowerCase()
    while (/\s/.test(value[cursor] ?? '')) cursor++
    if (!name || value[cursor] !== '=') {
      while (cursor < value.length && value[cursor] !== ';') cursor++
      continue
    }
    cursor++
    while (/\s/.test(value[cursor] ?? '')) cursor++
    let parameter = ''
    if (value[cursor] === '"') {
      cursor++
      while (cursor < value.length && value[cursor] !== '"') {
        if (value[cursor] === '\\' && cursor + 1 < value.length) cursor++
        parameter += value[cursor] ?? ''
        cursor++
      }
      if (value[cursor] === '"') cursor++
    }
    else {
      const valueStart = cursor
      while (cursor < value.length && value[cursor] !== ';') cursor++
      parameter = value.slice(valueStart, cursor).trim()
    }
    if (!parameters.has(name)) parameters.set(name, parameter)
  }
  return parameters
}

function isPublicDomainLicense(value: string) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const path = url.pathname.replace(/\/+$/, '').toLowerCase()
    return url.protocol === 'https:' && host === 'creativecommons.org'
      && (path === '/publicdomain/zero/1.0' || path === '/publicdomain/mark/1.0')
  }
  catch {
    return false
  }
}

export type RightsDecision = {
  status: 'permitted' | 'unknown' | 'prohibited'
  provenance: 'noarchive' | 'link_license' | 'html_license' | 'none'
  policyVersion: typeof LEARN_V2_RIGHTS_POLICY_VERSION
}

export function classifyRetentionRights(headers: IncomingHttpHeaders, html?: string): RightsDecision {
  let headElements: Element[] = []
  if (html) {
    try {
      const { document } = parseHTML(html)
      headElements = Array.from(document.head?.children ?? [])
    }
    catch {
      // Malformed metadata never upgrades retention rights.
    }
  }
  return classifyRetentionRightsFromHead(headers, headElements)
}

function classifyRetentionRightsFromHead(headers: IncomingHttpHeaders, headElements: Element[]): RightsDecision {
  const htmlRobots = headElements
    .filter(element => element.tagName.toLowerCase() === 'meta')
    .filter((element) => {
      const name = element.getAttribute('name')?.trim().toLowerCase()
      return name === 'robots' || name === LEARN_V2_ROBOTS_PRODUCT_TOKEN
    })
    .map(element => element.getAttribute('content') ?? '')
    .join(' ')
  const robots = `${header(headers, 'x-robots-tag') ?? ''} ${htmlRobots}`
  if (/\bnoarchive\b/i.test(robots)) {
    return { status: 'prohibited', provenance: 'noarchive', policyVersion: LEARN_V2_RIGHTS_POLICY_VERSION }
  }
  const link = header(headers, 'link') ?? ''
  for (const item of splitLinkHeader(link)) {
    const target = item.match(/^\s*<([^>]+)>/)?.[1]
    const relations = (linkParameters(item).get('rel') ?? '').toLowerCase().split(/\s+/)
    if (target && relations.includes('license') && isPublicDomainLicense(target)) {
      return { status: 'permitted', provenance: 'link_license', policyVersion: LEARN_V2_RIGHTS_POLICY_VERSION }
    }
  }
  const license = header(headers, 'license')
  if (license && isPublicDomainLicense(license.trim())) {
    return { status: 'permitted', provenance: 'link_license', policyVersion: LEARN_V2_RIGHTS_POLICY_VERSION }
  }
  for (const element of headElements) {
    if (element.tagName.toLowerCase() !== 'link') continue
    const rel = (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const href = element.getAttribute('href') ?? undefined
    if (href && rel.includes('license') && isPublicDomainLicense(href)) {
      return { status: 'permitted', provenance: 'html_license', policyVersion: LEARN_V2_RIGHTS_POLICY_VERSION }
    }
  }
  return { status: 'unknown', provenance: 'none', policyVersion: LEARN_V2_RIGHTS_POLICY_VERSION }
}

async function requestBody(args: {
  url: URL
  transport: PinnedTransport
  deadlineAt: number
  now: Clock
  maxWireBytes: number
  maxDecodedBytes: number
  acceptedMime?: Set<string>
}) {
  const response = await args.transport(args.url, args.deadlineAt)
  try {
    assertDeadline(args.deadlineAt, args.now)
    const status = response.statusCode ?? 0
    if (status === 206 || header(response.headers, 'content-range') !== undefined) throw new SafeFetchError('partial_content')
    if (status === 401 || status === 403) throw new SafeFetchError('authentication_required')
    const declaredLength = Number(header(response.headers, 'content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > args.maxWireBytes) throw new SafeFetchError('declared_size_overflow')
    if (status !== 200) throw new SafeFetchError('http_status', status === 408 || status === 425 || status === 429 || status >= 500)
    const { mediaType, charset } = mediaTypeAndCharset(header(response.headers, 'content-type'))
    if (args.acceptedMime && !args.acceptedMime.has(mediaType)) throw new SafeFetchError('unsupported_mime')
    const wire = await collectWireBody(response, args.maxWireBytes, args.deadlineAt, args.now)
    const body = decodeBody(wire, header(response.headers, 'content-encoding'), args.deadlineAt, args.maxDecodedBytes, args.now)
    return { response, body, mediaType, charset, wireBytes: wire.length }
  }
  catch (error) {
    dispose(response)
    throw error
  }
}

async function fetchRobots(source: URL, transport: PinnedTransport, deadlineAt: number, now: Clock) {
  let current = new URL('/robots.txt', source.origin)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    assertDeadline(deadlineAt, now)
    const response = await transport(current, deadlineAt)
    try {
      assertDeadline(deadlineAt, now)
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = header(response.headers, 'location')
        if (!location) throw new SafeFetchError('redirect_missing_location')
        if (redirects === MAX_REDIRECTS) throw new SafeFetchError('redirect_limit')
        current = parseAndValidateSourceUrl(location, current)
        continue
      }
      if (status >= 400 && status < 500) return ''
      if (status < 200 || status >= 300) throw new SafeFetchError('robots_unavailable', status >= 500)
      const declaredLength = Number(header(response.headers, 'content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > MAX_ROBOTS_BYTES) throw new SafeFetchError('robots_unavailable')
      const wire = await collectWireBody(response, MAX_ROBOTS_BYTES, deadlineAt, now)
      const decoded = decodeBody(wire, header(response.headers, 'content-encoding'), deadlineAt, MAX_ROBOTS_BYTES, now)
      const { charset } = mediaTypeAndCharset(header(response.headers, 'content-type'))
      return decodeText(decoded, charset, deadlineAt, now)
    }
    finally {
      dispose(response)
    }
  }
  throw new SafeFetchError('redirect_limit')
}

function redirectStatus(status: number) {
  return [301, 302, 303, 307, 308].includes(status)
}

export type SafeFetchResult = {
  finalUrl: string
  publicLocator: string
  contentHash: string
  contentType: 'text/html' | 'text/plain' | 'application/pdf'
  wireBytes: number
  decodedBytes: number
  excerpt?: string
  trustClassification: 'untrusted_source_data'
  rights: RightsDecision
  fetchPolicyVersion: typeof LEARN_V2_FETCH_POLICY_VERSION
}

function parseHtmlOnce(html: string) {
  const { document } = parseHTML(html)
  const headElements = Array.from(document.head?.children ?? [])
  for (const element of Array.from(document.querySelectorAll('script, style, template, noscript'))) element.remove()
  const visibleText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim()
  return { headElements, visibleText }
}

function truncateCodePoints(value: string, limit: number) {
  return Array.from(value).slice(0, limit).join('')
}

export async function safeFetchSource(value: string, options: {
  transport?: PinnedTransport
  deadlineMs?: number
  now?: () => number
  maxWireBytes?: number
  maxDecodedBytes?: number
} = {}): Promise<SafeFetchResult> {
  const now = options.now ?? Date.now
  const deadlineAt = now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS)
  const transport = options.transport ?? createPinnedHttpsTransport({ now })
  let current = parseAndValidateSourceUrl(value)
  const acceptedMime = new Set(['text/html', 'text/plain', 'application/pdf'])

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    assertDeadline(deadlineAt, now)
    const robots = await fetchRobots(current, transport, deadlineAt, now)
    assertDeadline(deadlineAt, now)
    if (!isRobotsAllowed(robots, current)) throw new SafeFetchError('robots_denied')

    const response = await transport(current, deadlineAt)
    try {
      assertDeadline(deadlineAt, now)
      const status = response.statusCode ?? 0
      if (redirectStatus(status)) {
        const location = header(response.headers, 'location')
        if (!location) throw new SafeFetchError('redirect_missing_location')
        if (redirects === MAX_REDIRECTS) throw new SafeFetchError('redirect_limit')
        current = parseAndValidateSourceUrl(location, current)
        continue
      }
      // Consume only complete 200 representations. requestBody deliberately
      // owns disposal for every status/MIME/size/decode exit.
      const result = await requestBody({
        url: current,
        transport: async () => response,
        deadlineAt,
        now,
        maxWireBytes: options.maxWireBytes ?? MAX_WIRE_BYTES,
        maxDecodedBytes: options.maxDecodedBytes ?? MAX_DECODED_BYTES,
        acceptedMime,
      })
      validateContentSignature(result.body, result.mediaType)
      assertDeadline(deadlineAt, now)
      let text: string | undefined
      if (result.mediaType === 'text/html' || result.mediaType === 'text/plain') {
        text = decodeText(result.body, result.charset, deadlineAt, now)
      }
      let rights: RightsDecision
      let excerptText = text
      if (result.mediaType === 'text/html') {
        if (result.body.length > MAX_HTML_PARSE_BYTES) throw new SafeFetchError('decoded_size_overflow')
        let parsed: ReturnType<typeof parseHtmlOnce> | undefined
        try {
          parsed = parseHtmlOnce(text ?? '')
        }
        catch {
          // Malformed HTML cannot authorize retention and has no safe excerpt.
        }
        rights = parsed
          ? classifyRetentionRightsFromHead(response.headers, parsed.headElements)
          : classifyRetentionRights(response.headers)
        excerptText = parsed?.visibleText
      }
      else {
        rights = classifyRetentionRights(response.headers)
      }
      assertDeadline(deadlineAt, now)
      const contentHash = createHash('sha256').update(result.body).digest('hex')
      assertDeadline(deadlineAt, now)
      const excerpt = rights.status === 'permitted' && excerptText
        ? truncateCodePoints(excerptText.replace(/\s+/g, ' ').trim(), MAX_EXCERPT_CHARS) || undefined
        : undefined
      assertDeadline(deadlineAt, now)
      return {
        finalUrl: canonicalSourceUrl(current.toString()),
        publicLocator: publicLocator(current.toString()),
        contentHash,
        contentType: result.mediaType as SafeFetchResult['contentType'],
        wireBytes: result.wireBytes,
        decodedBytes: result.body.length,
        excerpt,
        trustClassification: 'untrusted_source_data',
        rights,
        fetchPolicyVersion: LEARN_V2_FETCH_POLICY_VERSION,
      }
    }
    finally {
      dispose(response)
    }
  }
  throw new SafeFetchError('redirect_limit')
}
