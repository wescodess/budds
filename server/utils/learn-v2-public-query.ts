export const LEARN_V2_PUBLIC_QUERY_POLICY_VERSION = 'learn-v2-public-query.v1'
export const MAX_PUBLIC_QUERY_CHARS = 200
export const MAX_PUBLIC_QUERY_WORDS = 32

export type PublicQueryDenialCode =
  | 'invalid_query'
  | 'query_too_large'
  | 'private_data_indicator'

export class PublicQueryAdmissionError extends Error {
  readonly code: PublicQueryDenialCode

  constructor(code: PublicQueryDenialCode) {
    super('Public search query denied')
    this.name = 'PublicQueryAdmissionError'
    this.code = code
  }
}

const EMAIL = /(?:^|[^\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}](?:[\p{L}\p{N}.-]*[\p{L}\p{N}])?(?=$|[^\p{L}\p{N}.-])/iu
const URL = /(?:\b(?:https?|ftp):\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|io|co|dev|app|ai|ca|uk)(?:\/|\b))/iu
const PRIVATE_OR_HOST_PATH = /(?:\b(?:localhost|[a-z0-9-]+\.(?:local|internal|corp|lan))(?::\d{1,5})?(?:\/[^\s]*)?\b|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/[^\s]*)?|\[[A-F0-9]*:[A-F0-9:]+\](?::\d{1,5})?(?:\/[^\s]*)?|\b(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}(?::\d{1,5})?(?:\/[^\s]+)?\b)/iu
const UNICODE_OR_PORTED_HOST_PATH = /(?:(?:^|[^\p{L}\p{N}-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}[\p{L}\p{N}])?\.)+\p{L}[\p{L}\p{N}-]{1,62}(?::\d{1,5})?(?:\/[^\s]*)?(?=$|[^\p{L}\p{N}.-])|(?:^|\s)[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}[\p{L}\p{N}])?:\d{1,5}\/[^\s]+)/iu
const BARE_IPV6 = /(?:^|\s)(?:[A-F0-9]{1,4}(?::[A-F0-9]{0,4}){3,7}|[A-F0-9]{0,4}::(?:[A-F0-9]{0,4}:)*[A-F0-9]{0,4})(?:\/[^\s]*)?(?=$|\s)/iu
const ALTERNATE_LOCATOR = /(?:\b[a-z][a-z0-9+.-]{1,31}:\/\/[^\s]+|\b(?:data|file|git|ldap|mailto|nfs|sftp|smb|ssh|telnet|urn):[^\s]+|\\\\[A-Za-z0-9._-]+\\[^\s]+)/iu
const FILE_OR_PATH = /(?:^|\s)(?:~\/|\.{0,2}\/|\/[A-Za-z0-9._-]+\/|[A-Za-z]:[\\/])|\b[\w.-]+\.(?:pdf|docx?|xlsx?|pptx?|txt|md|csv|json|ya?ml|env|pem|key)\b/iu
const SECRET = /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|password|passwd|credential|client[_ -]?secret|private[_ -]?key|secret)\b|\b(?:sk|pk)[_-][A-Za-z0-9_-]{8,}\b/iu
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
const GITHUB_TOKEN = /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u
const GOOGLE_API_KEY = /\bAIza[A-Za-z0-9_-]{35}\b/u
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u
const AWS_ACCESS_KEY_ID = /\b(?:A3T[A-Z0-9]|ABIA|ACCA|AGPA|AIDA|AIPA|AKIA|ANPA|ANVA|APKA|AROA|ASCA|ASIA)[A-Z0-9]{16}\b/u
const PEM_CREDENTIAL = /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE|PGP [A-Z ]+)-----/iu
const ACCOUNT_IDENTIFIER = /\b(?:account|customer|user|member|employee|student|patient)[_ -]?(?:id|number|no\.?)[\s:=#-]*[A-Za-z0-9_-]{3,}\b/iu
const PRIVATE_NOTE = /\b(?:unpublished|private|confidential|internal|personal)\s+(?:draft|note|memo|excerpt|document)\b/iu
const PERSON_CONTEXT = /\b(?:named|person|contact|employee|student|patient|client)\s+[A-Z][\p{L}'-]+\s+[A-Z][\p{L}'-]+\b/u
const ONLY_PERSON_NAME = /^\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){1,3}$/u
const PASSAGE_MARKER = /(?:^|\s)(?:dear\s+\p{L}+|from:\s|to:\s|subject:\s|meeting notes?:|transcript:)/iu

function deny(code: PublicQueryDenialCode): never {
  throw new PublicQueryAdmissionError(code)
}

function hasDisallowedControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!
    return code <= 8
      || code === 11
      || code === 12
      || (code >= 14 && code <= 31)
      || (code >= 127 && code <= 159)
      || /\p{Cf}/u.test(character)
  })
}

function hasStandaloneBase64Credential(value: string): boolean {
  const candidates = value.match(/[A-Za-z0-9+/_-]{48,}={0,2}/gu) ?? []
  return candidates.some(candidate => /[A-Z]/u.test(candidate)
    && /[a-z]/u.test(candidate)
    && /\d/u.test(candidate)
    && !/^\d+$/u.test(candidate))
}

function hasStandaloneHexCredential(value: string): boolean {
  return (value.match(/\b(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})\b/gu) ?? [])
    .some(candidate => /[a-f]/iu.test(candidate) && /\d/u.test(candidate))
}

export function admitLearnV2PublicQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string') deny('invalid_query')
  if (hasDisallowedControl(rawQuery)) deny('private_data_indicator')

  const normalized = rawQuery.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (normalized.length < 3) deny('invalid_query')
  if (normalized.length > MAX_PUBLIC_QUERY_CHARS) deny('query_too_large')

  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  if (words.length === 0) deny('invalid_query')
  if (words.length > MAX_PUBLIC_QUERY_WORDS) deny('private_data_indicator')

  if (
    EMAIL.test(normalized)
    || URL.test(normalized)
    || PRIVATE_OR_HOST_PATH.test(normalized)
    || UNICODE_OR_PORTED_HOST_PATH.test(normalized)
    || BARE_IPV6.test(normalized)
    || ALTERNATE_LOCATOR.test(normalized)
    || FILE_OR_PATH.test(normalized)
    || SECRET.test(normalized)
    || JWT.test(normalized)
    || GITHUB_TOKEN.test(normalized)
    || GOOGLE_API_KEY.test(normalized)
    || SLACK_TOKEN.test(normalized)
    || AWS_ACCESS_KEY_ID.test(normalized)
    || PEM_CREDENTIAL.test(normalized)
    || hasStandaloneBase64Credential(normalized)
    || hasStandaloneHexCredential(normalized)
    || ACCOUNT_IDENTIFIER.test(normalized)
    || PRIVATE_NOTE.test(normalized)
    || PERSON_CONTEXT.test(normalized)
    || ONLY_PERSON_NAME.test(normalized)
    || PASSAGE_MARKER.test(normalized)
  ) deny('private_data_indicator')

  return normalized
}
