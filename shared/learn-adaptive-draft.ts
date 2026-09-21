import { v } from 'convex/values'

export const NEED_FIRST_DRAFT_VERSION = 'learn-adaptive.need-draft.v1' as const
export const NEED_FIRST_DRAFT_MAX_NEED_BYTES = 8_000
export const NEED_FIRST_DRAFT_MAX_PASTE_BYTES = 64 * 1_024

const learningIntentValidator = v.union(v.literal('understand'), v.literal('prepare'), v.literal('build'), v.literal('master'), v.literal('refresh'), v.literal('explore'))
const availableTimeValidator = v.union(v.literal('15'), v.literal('25'), v.literal('45'), v.literal('60'), v.literal('no_limit'))

const SHA256 = /^sha256:[a-f0-9]{64}$/
const INPUT_KEYS = new Set(['need', 'outcome', 'intent', 'availableTime', 'sourceScope'])

export const needFirstSourceInputValidator = v.union(
  v.object({ kind: v.literal('none') }),
  v.object({ kind: v.literal('folder'), folderId: v.id('folders') }),
  v.object({ kind: v.literal('document'), documentId: v.id('documents') }),
  v.object({ kind: v.literal('url'), url: v.string() }),
  v.object({ kind: v.literal('pasted'), contentDigest: v.string(), byteCount: v.number() }),
)

export const needFirstDraftArgsValidator = {
  need: v.string(),
  outcome: v.optional(v.string()),
  intent: learningIntentValidator,
  availableTime: availableTimeValidator,
  sourceScope: needFirstSourceInputValidator,
}

export type NeedFirstSourceInput =
  | { kind: 'none' }
  | { kind: 'folder', folderId: string }
  | { kind: 'document', documentId: string }
  | { kind: 'url', url: string }
  | { kind: 'pasted', contentDigest: string, byteCount: number }

export type NeedFirstDraftInput = {
  need: string
  outcome?: string
  intent: 'understand' | 'prepare' | 'build' | 'master' | 'refresh' | 'explore'
  availableTime: '15' | '25' | '45' | '60' | 'no_limit'
  sourceScope: NeedFirstSourceInput
}

export function canonicalNeedFirstUrl(value: string) {
  if (!value || value.length > 2_048) throw new Error('Source URL is invalid')
  let parsed: URL
  try { parsed = new URL(value) }
  catch { throw new Error('Source URL is invalid') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('Source URL is invalid')
  parsed.hash = ''
  const canonical = parsed.toString()
  if (canonical.length > 2_048) throw new Error('Source URL is invalid')
  return canonical
}

export function validateNeedFirstDraftInput<T extends NeedFirstDraftInput>(input: T): T {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !INPUT_KEYS.has(key))) throw new Error('Learning draft contains unsupported fields')
  const needBytes = new TextEncoder().encode(input.need).byteLength
  if (input.need.trim().length < 8 || needBytes > NEED_FIRST_DRAFT_MAX_NEED_BYTES) throw new Error('Use at least 8 meaningful characters to describe what you need')
  if (input.outcome !== undefined && input.outcome.trim().length > 0) {
    const outcomeBytes = new TextEncoder().encode(input.outcome).byteLength
    if (input.outcome.trim().length < 8 || outcomeBytes > NEED_FIRST_DRAFT_MAX_NEED_BYTES) throw new Error('Use at least 8 meaningful characters to describe a useful outcome')
  }
  const scope = input.sourceScope
  if (!scope || typeof scope !== 'object') throw new Error('Choose a valid source scope')
  if (scope.kind === 'folder' && !scope.folderId) throw new Error('Choose a folder')
  else if (scope.kind === 'document' && !scope.documentId) throw new Error('Choose a document')
  else if (scope.kind === 'url') canonicalNeedFirstUrl(scope.url)
  else if (scope.kind === 'pasted') {
    if (!SHA256.test(scope.contentDigest)) throw new Error('Pasted material digest is invalid')
    if (!Number.isSafeInteger(scope.byteCount) || scope.byteCount < 1 || scope.byteCount > NEED_FIRST_DRAFT_MAX_PASTE_BYTES) throw new Error('Pasted material must be between 1 and 65536 bytes')
  }
  return input
}
