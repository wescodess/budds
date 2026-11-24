import assert from 'node:assert/strict'
import { createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { canonical, hash, readJson, exactKeys, POLICY } from './artifacts.mjs'
import { LIMITS } from './contract.mjs'
import { readConfiguredRuntimeValue } from '../../../server/utils/runtime-config.ts'

export function verifyOwnerDocument(envelope, publicKey) {
  exactKeys(envelope, ['payload', 'signature'])
  const key = createPublicKey(publicKey)
  assert.equal(key.asymmetricKeyType, 'ed25519', 'Owner trust key must be Ed25519')
  assert.ok(verify(null, Buffer.from(canonical(envelope.payload)), key, Buffer.from(envelope.signature, 'base64')), 'Owner signature is invalid')
  return envelope.payload
}

function signedDocument(file, trustKey) {
  return verifyOwnerDocument(readJson(file), readFileSync(trustKey))
}

export const ownerKeyDigest = publicKey => hash(createPublicKey(publicKey).export({ type: 'spki', format: 'der' }))

export function verifySavedApproval(saved, { approvalFile, costFile, trustKey }) {
  if (saved.ownerKeyDigest) assert.equal(ownerKeyDigest(readFileSync(trustKey)), saved.ownerKeyDigest, 'Recovery requires the original owner key')
  assert.equal(hash(signedDocument(approvalFile, trustKey)), saved.approvalDigest, 'Recovery requires the original signed approval')
  assert.equal(hash(signedDocument(costFile, trustKey)), saved.costDigest, 'Recovery requires the original signed cost evidence')
}

export function admitLive({ pins, pinsDigest, item, request, requestPins, approvalFile, costFile, trustKey, now }) {
  assert.equal(pins.mode, 'live')
  const adapter = pins.adapters.find(adapter => adapter.id === item.adapter)
  if (adapter.role === 'baseline') {
    assert.equal(globalThis.useRuntimeConfig, undefined, 'Live CLI cannot use an unpinned runtime configuration')
    const account = readConfiguredRuntimeValue(undefined, 'NUXT_CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID')
    const gateway = readConfiguredRuntimeValue(undefined, 'NUXT_CLOUDFLARE_AI_GATEWAY_ID', 'CLOUDFLARE_AI_GATEWAY_ID')
    assert.equal(`https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/openrouter/v1/chat/completions`, request.endpoint,
      'Gateway transport differs from its frozen non-secret pin')
  }
  assert.ok(approvalFile && costFile && trustKey, 'Separate signed owner budget/provider/privacy approval and cost evidence are required')
  assert.notEqual(approvalFile, costFile, 'Approval and cost evidence must be separate documents')
  assert.ok(process.env.BUDDS_E2E_MODE !== 'true'
    && !Object.entries(process.env).some(([key, value]) => /(?:E2E|DETERMINISTIC)/.test(key) && /LEARN|PROVIDER|ADAPTIVE/.test(key) && value && value !== 'false')
    && !process.env.BUDDS_E2E_DETERMINISTIC_PROVIDER
    && !process.env.BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL, 'Deterministic E2E provider mode is forbidden live')
  const approval = signedDocument(approvalFile, trustKey)
  exactKeys(approval, ['version', 'owner', 'approvalId', 'pinsDigest', 'budgetMicroUsd', 'budgetApproved', 'providersApproved',
    'privacyApproved', 'payloadPolicy', 'issuedAt', 'expiresAt', 'costEvidenceDigest'])
  assert.equal(approval.version, 'learn-v2.harness-owner-approval.v1')
  assert.ok(typeof approval.owner === 'string' && approval.owner.length > 0 && typeof approval.approvalId === 'string' && approval.approvalId.length > 0)
  assert.equal(approval.pinsDigest, pinsDigest)
  assert.equal(approval.budgetMicroUsd, pins.budgetMicroUsd)
  assert.equal(approval.budgetApproved, true)
  assert.equal(approval.providersApproved, true)
  assert.equal(approval.privacyApproved, true)
  assert.equal(approval.payloadPolicy, POLICY)
  assert.ok([approval.issuedAt, approval.expiresAt, now].every(Number.isSafeInteger)
    && approval.issuedAt <= now && now < approval.expiresAt, 'Owner approval is stale')
  const cost = signedDocument(costFile, trustKey)
  exactKeys(cost, ['version', 'pinsDigest', 'priceAccessDate', 'verifiedAt', 'expiresAt', 'includesSchemaAndSystemOverhead',
    'includesFeesTaxesAndPurchases', 'method', 'requests'])
  assert.equal(hash(cost), approval.costEvidenceDigest)
  assert.equal(cost.version, 'learn-v2.harness-cost-reservation.v1')
  assert.equal(cost.pinsDigest, pinsDigest)
  assert.equal(cost.priceAccessDate, pins.priceAccessDate)
  assert.ok([cost.verifiedAt, cost.expiresAt].every(Number.isSafeInteger)
    && cost.verifiedAt <= now && now < cost.expiresAt && now - cost.verifiedAt <= 86_400_000, 'Cost evidence is stale')
  assert.equal(cost.includesSchemaAndSystemOverhead, true)
  assert.equal(cost.includesFeesTaxesAndPurchases, true)
  assert.equal(cost.method, 'verified_conservative_reservation', 'An estimated token count is not a reservation')
  assert.ok(Array.isArray(cost.requests) && cost.requests.length === pins.adapters.length * 256, 'Cost coverage is incomplete')
  assert.equal(new Set(cost.requests.map(row => row.id)).size, cost.requests.length)
  assert.ok(Array.isArray(requestPins) && requestPins.length === cost.requests.length, 'Complete frozen request coverage required')
  const requestDigests = new Map(requestPins.map(row => [row.id, row.requestDigest]))
  assert.ok(cost.requests.every(row => requestDigests.get(row.id) === row.requestDigest), 'Cost evidence has missing or changed request pins')
  const quote = cost.requests.find(row => row.id === item.blind.id)
  assert.ok(quote, 'Missing complete-request cost reservation')
  exactKeys(quote, ['id', 'requestDigest', 'inputTokenBound', 'outputTokenBound', 'inputMicroUsdPerMillion',
    'outputMicroUsdPerMillion', 'overheadMicroUsd', 'maximumMicroUsd', 'evidenceReference'])
  assert.equal(quote.requestDigest, hash(request))
  for (const key of ['inputTokenBound', 'outputTokenBound', 'inputMicroUsdPerMillion', 'outputMicroUsdPerMillion', 'overheadMicroUsd', 'maximumMicroUsd']) {
    assert.ok(Number.isSafeInteger(quote[key]) && quote[key] >= 0, 'Invalid finite cost bound')
  }
  assert.ok(quote.inputTokenBound > 0 && quote.inputTokenBound <= LIMITS.maxInputTokens)
  const role = adapter.role
  assert.equal(quote.outputTokenBound, role === 'baseline' ? 1200 : 2048)
  const minimum = (BigInt(quote.inputTokenBound) * BigInt(quote.inputMicroUsdPerMillion)
    + BigInt(quote.outputTokenBound) * BigInt(quote.outputMicroUsdPerMillion) + 999_999n) / 1_000_000n + BigInt(quote.overheadMicroUsd)
  assert.ok(quote.maximumMicroUsd > 0 && BigInt(quote.maximumMicroUsd) >= minimum && quote.evidenceReference,
    'Reservation must conservatively cover complete billed input, output/thinking, overhead and fees')
  assert.ok(cost.requests.every(row => Number.isSafeInteger(row.maximumMicroUsd) && row.maximumMicroUsd > 0), 'Invalid reservation coverage')
  const total = cost.requests.reduce((sum, row) => sum + row.maximumMicroUsd, 0)
  assert.ok(Number.isSafeInteger(total) && total <= approval.budgetMicroUsd, 'Full cost reservation exceeds owner approval')
  return { reservationMicroUsd: quote.maximumMicroUsd, approvalDigest: hash(approval), costDigest: hash(cost), ownerKeyDigest: ownerKeyDigest(readFileSync(trustKey)),
    validUntil: Math.min(approval.expiresAt, cost.expiresAt), quote }
}
