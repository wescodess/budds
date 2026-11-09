import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { exactKeys, hash, readJson } from './artifacts.mjs'
import { verifyOwnerDocument, verifySavedApproval, ownerKeyDigest } from './live-approval.mjs'

export function verifyWriteOff(authorization, state, intent, writtenOffAt) {
  exactKeys(authorization, ['document', 'approval', 'ownerKey'])
  assert.ok(typeof authorization.ownerKey === 'string' && authorization.ownerKey.length <= 4096, 'Owner public key required')
  if (intent.payload.approval.ownerKeyDigest) assert.equal(ownerKeyDigest(authorization.ownerKey), intent.payload.approval.ownerKeyDigest, 'Write-off owner key differs')
  const approval = verifyOwnerDocument(authorization.approval, authorization.ownerKey)
  assert.equal(hash(approval), intent.payload.approval.approvalDigest, 'Write-off requires the original approval key')
  assert.equal(approval.costEvidenceDigest, intent.payload.approval.costDigest)
  const payload = verifyOwnerDocument(authorization.document, authorization.ownerKey)
  exactKeys(payload, ['version', 'directory', 'pinsDigest', 'intentDigest', 'approvalDigest', 'reason', 'issuedAt'])
  assert.equal(payload.version, 'learn-v2.harness-write-off.v1')
  assert.equal(payload.directory, state.directory, 'Write-off run directory differs')
  assert.equal(payload.pinsDigest, state.pinsDigest, 'Write-off run pins differ')
  assert.equal(payload.intentDigest, intent.digest, 'Write-off intent differs')
  assert.equal(payload.approvalDigest, intent.payload.approval.approvalDigest, 'Write-off approval differs')
  assert.ok(typeof payload.reason === 'string' && payload.reason.trim().length > 0 && payload.reason.length <= 1000, 'Write-off reason required')
  assert.ok(Number.isSafeInteger(writtenOffAt) && Number.isSafeInteger(payload.issuedAt)
    && payload.issuedAt >= intent.payload.startedAt && payload.issuedAt <= writtenOffAt, 'Invalid write-off time')
  assert.ok(writtenOffAt >= Math.max(intent.payload.startedAt, state.terminals.get(intent.payload.id)?.payload.terminalAt ?? 0,
    state.reconciliations.get(intent.payload.id)?.payload.reconciledAt ?? 0), 'Write-off predates saved evidence')
  return payload
}

export function authorizeWriteOff(file, state, intent, options, now) {
  verifySavedApproval(intent.payload.approval, options)
  const authorization = { document: readJson(file), approval: readJson(options.approvalFile), ownerKey: readFileSync(options.trustKey, 'utf8') }
  verifyWriteOff(authorization, state, intent, now)
  return authorization
}
