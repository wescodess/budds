import { describe, expect, test } from 'vitest'
import {
  admitLearnV2PublicQuery,
  MAX_PUBLIC_QUERY_CHARS,
  PublicQueryAdmissionError,
} from './learn-v2-public-query'

describe('Learn V2 public topic admission', () => {
  test('normalizes an explicitly authored public topic', () => {
    expect(admitLearnV2PublicQuery('  history   of solar energy in Ontario, 2020–2025  '))
      .toBe('history of solar energy in Ontario, 2020–2025')
  })

  test.each([
    ['email', 'research jane@example.com'],
    ['bare local email', 'research alice@corp'],
    ['URL', 'summarize https://private.example.test/notes'],
    ['path', 'use /Users/alice/Documents/private-notes.md'],
    ['filename', 'compare quarterly-results.xlsx'],
    ['credential', 'look up api_key sk_secretvalue'],
    ['JWT', `inspect ${['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.')}`],
    ['GitHub token', `inspect ${'ghp_'}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'}`],
    ['GitHub fine-grained token', `inspect ${'github_pat_'}${'11AA0ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'}`],
    ['AWS access key ID', `inspect ${'AKIA'}${'IOSFODNN7EXAMPLE'}`],
    ['PEM credential', `inspect ${'-----BEGIN'} PRIVATE KEY-----`],
    ['base64 credential', `inspect ${'dGhpc0lzQVNlbnNpdGl2ZUJhc2U2NFRva2Vu'}${'MTIzNDU2Nzg5MCsvPQ=='}`],
    ['unpadded credential', `inspect ${'dGhpc0lzQVNlbnNpdGl2ZUJhc2U2NFRva2Vu'}${'MTIzNDU2Nzg5MDEyMw'}`],
    ['hex credential', `inspect ${'0123456789abcdef0123'}${'456789abcdef01234567'}`],
    ['Google API key', `inspect ${'AIzaSy'}${'A1234567890abcdefghijklmnopqrstuv'}`],
    ['Slack token', `inspect ${'xoxb-'}${'123456789012-abcdefghijklmnop'}`],
    ['IPv4 host', 'research 10.0.0.1/admin'],
    ['IPv6 host', 'research [fd00::1]/admin'],
    ['bare IPv6 host', 'research fd00::1/admin'],
    ['UNC path', String.raw`research \\private-server\restricted\notes.txt`],
    ['POSIX absolute path', 'research /etc'],
    ['Windows drive path', String.raw`research C:\Users\alice`],
    ['forward-slash Windows drive path', 'research C:/Users/alice/private-notes'],
    ['ported internal host path', 'research internal-host:8080/private-notes'],
    ['Unicode email address', 'research 用户@例子.公司'],
    ['Unicode host address', 'research 内部.公司/私密'],
    ['alternate locator scheme', 'research smb://private-server/restricted'],
    ['opaque alternate URL scheme', 'research file:/etc/private-notes'],
    ['internal host', 'research intranet.corp.local/private'],
    ['dotted host path', 'research documents.example.museum/private'],
    ['pathless dotted private locator', 'research private.documents.example.museum'],
    ['two-label private locator', 'research secrets.museum'],
    ['account identifier', 'customer id: CUS_123456'],
    ['unpublished note', 'expand this unpublished note about batteries'],
    ['person context', 'research employee Jane Private'],
    ['passage', 'Dear Alex, this is the meeting transcript: keep it private'],
  ])('rejects a deterministic %s indicator without echoing input', (_kind, query) => {
    let error: unknown
    try {
      admitLearnV2PublicQuery(query)
    }
    catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PublicQueryAdmissionError)
    expect(String(error)).not.toContain(query)
  })

  test('rejects control-rich and passage-like input', () => {
    expect(() => admitLearnV2PublicQuery('public\u0000topic')).toThrow('Public search query denied')
    expect(() => admitLearnV2PublicQuery(Array.from({ length: 33 }, (_, index) => `word${index}`).join(' ')))
      .toThrow('Public search query denied')
  })

  test.each([
    ['zero-width joiner', 'public\u200Dtopic'],
    ['word joiner', 'public\u2060topic'],
    ['right-to-left override', 'public\u202Etopic'],
    ['byte-order mark', 'public\uFEFFtopic'],
  ])('rejects Unicode Cf %s before normalization', (_name, query) => {
    expect(() => admitLearnV2PublicQuery(query)).toThrow('Public search query denied')
  })

  test('keeps person-name admission explicitly non-universal', () => {
    expect(admitLearnV2PublicQuery('Ada Lovelace contributions to computing'))
      .toBe('Ada Lovelace contributions to computing')
  })

  test.each([
    'history of web 2.0 standards',
    'history of broadcasts at 12:30:00 UTC',
  ])('does not mistake an ordinary dotted public topic for a private locator: %s', (query) => {
    expect(admitLearnV2PublicQuery(query)).toBe(query)
  })

  test('rejects empty and oversized values with a bounded sanitized error', () => {
    expect(() => admitLearnV2PublicQuery('  ')).toThrow('Public search query denied')
    const oversized = 'x'.repeat(MAX_PUBLIC_QUERY_CHARS + 1)
    try {
      admitLearnV2PublicQuery(oversized)
    }
    catch (error) {
      expect(String(error)).toBe('PublicQueryAdmissionError: Public search query denied')
    }
  })
})
