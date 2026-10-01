/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { ADAPTIVE_ACTIVATION_CONFIGURATION } from '../shared/adaptive-activation-approval'
import shippedApproval from '../docs/operations/adaptive-learn-activation-approval.v1.json'
import { syntheticReviewedActivationApproval } from '../tests/fixtures/adaptive-activation-approval'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|activation-owner', subject: 'activation-owner', issuer: 'https://auth.example.com' }

const previousFlag = process.env.LEARN_V2_ENABLED
beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true'; ADAPTIVE_ACTIVATION_CONFIGURATION.approval = shippedApproval })
afterEach(() => { if (previousFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = previousFlag })

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: true })
  return { t, owner }
}

test('pending activation approval cannot grant a cohort entitlement', async () => {
  const { owner } = await setup()
  await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })).rejects.toThrow(/approval/)
  await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
})

test('reviewed synthetic configuration admits only an entitled authenticated owner', async () => {
  const { t, owner } = await setup()
  ADAPTIVE_ACTIVATION_CONFIGURATION.approval = syntheticReviewedActivationApproval()
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'allowed' })
  const other = t.withIdentity({ ...OWNER, tokenIdentifier: 'https://auth.example.com|other', subject: 'other' })
  await other.mutation(api.users.upsertUser, {})
  await other.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  await expect(other.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied', fallbackRoute: { name: 'index', href: '/' } })
  await expect(other.query(api.learnAdaptive.listResumeCandidates, {})).rejects.toThrow(/denied/)
  await expect(t.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })).rejects.toThrow(/denied/)
  await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true, approval: syntheticReviewedActivationApproval() } as never)).rejects.toThrow()
  await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true, tokenIdentifier: 'other' } as never)).rejects.toThrow()
})

test.each<[string, unknown]>([
  ['missing', undefined], ['malformed', 'approved'],
  ['unsupported version', { ...syntheticReviewedActivationApproval(), version: 'future.v2' }],
  ['wrong scope', { ...syntheticReviewedActivationApproval(), scope: 'ga' }],
  ['unsigned', { ...syntheticReviewedActivationApproval(), owners: {} }],
  ['conflicting decision', { ...syntheticReviewedActivationApproval(), approved: true }],
  ['unapproved', { ...syntheticReviewedActivationApproval(), decision: 'rejected' }],
  ...['accessibility', 'security', 'operations', 'rollback'].flatMap<[string, unknown]>((role) => {
    const artifact = syntheticReviewedActivationApproval()
    const owner = artifact.owners[role]!
    return [
      [`${role} unnamed`, { ...artifact, owners: { ...artifact.owners, [role]: { ...owner, principal: null } } }],
      [`${role} SHA mismatch`, { ...artifact, owners: { ...artifact.owners, [role]: { ...owner, testedSha: 'b'.repeat(40) } } }],
      [`${role} evidence absent`, { ...artifact, owners: { ...artifact.owners, [role]: { ...owner, evidence: [] } } }],
      [`${role} unreviewed evidence`, { ...artifact, owners: { ...artifact.owners, [role]: { ...owner, evidence: [{ ...owner.evidence[0], reviewDecision: 'pending' }] } } }],
      [`${role} local-only evidence`, { ...artifact, owners: { ...artifact.owners, [role]: { ...owner, evidence: [{ ...owner.evidence[0], provenance: 'local_synthetic' }] } } }],
      [`${role} evidence SHA mismatch`, { ...artifact, owners: { ...artifact.owners, [role]: { ...owner, evidence: [{ ...owner.evidence[0], testedSha: 'b'.repeat(40) }] } } }],
    ]
  }),
])('denies a new grant with %s approval evidence', async (_name, approval) => {
  const { owner } = await setup()
  ADAPTIVE_ACTIVATION_CONFIGURATION.approval = approval
  await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })).rejects.toThrow(/approval/)
  await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
  await expect(owner.query(api.learnAdaptive.listResumeCandidates, {})).rejects.toThrow(/denied/)
})

test('revocation survives invalid approval, selects named fallback, and preserves owner export', async () => {
  const { t, owner } = await setup()
  ADAPTIVE_ACTIVATION_CONFIGURATION.approval = syntheticReviewedActivationApproval()
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  const threadId = await t.run(ctx => ctx.db.insert('learningThreads', { userId: OWNER.tokenIdentifier, originalNeed: 'Keep my work through rollback', intent: 'understand', availableTime: '15', authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'ready', revision: 1, createdAt: 1, updatedAt: 1 }))
  ADAPTIVE_ACTIVATION_CONFIGURATION.approval = undefined
  // Review configuration is admission-only: existing access needs an explicit revoke.
  await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'allowed' })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
  await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied', fallbackRoute: { name: 'app-learn', href: '/app/learn?legacy=v2' } })
  await expect(owner.query(api.learnAdaptive.getThread, { threadId })).rejects.toThrow(/denied/)
  await expect(owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreads', paginationOpts: { cursor: null, numItems: 8 } })).resolves.toMatchObject({ page: [{ _id: threadId, originalNeed: 'Keep my work through rollback', revision: 1, lifecycle: 'ready' }] })
  process.env.LEARN_V2_ENABLED = 'false'
  await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied', fallbackRoute: { name: 'index', href: '/' } })
})

test.each(['http://example.invalid/review', 'https://user:secret@example.invalid/review', 'https://example.invalid/review?token=private', 'https://example.invalid/review#private', `https://example.invalid/${'x'.repeat(257)}`])('unsafe evidence reference %s cannot authorize a grant', async (reference) => {
  const { owner } = await setup()
  const approval = syntheticReviewedActivationApproval()
  approval.owners.security!.evidence[0]!.reference = reference
  ADAPTIVE_ACTIVATION_CONFIGURATION.approval = approval
  await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })).rejects.toThrow(/approval/)
  await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
})

test('synthetic browser approval stays behind the platform loopback boundary and preserves explicit revocation', async () => {
  const previous = {
    BUDDS_E2E_MODE: process.env.BUDDS_E2E_MODE,
    BUDDS_E2E_AUTH_TOKEN: process.env.BUDDS_E2E_AUTH_TOKEN,
    CONVEX_CLOUD_URL: process.env.CONVEX_CLOUD_URL,
  }
  try {
    process.env.BUDDS_E2E_MODE = 'true'
    process.env.BUDDS_E2E_AUTH_TOKEN = 'a'.repeat(32)
    process.env.CONVEX_CLOUD_URL = 'https://production.convex.cloud'
    const t = convexTest(schema, modules)
    const owner = t.withIdentity(OWNER)
    await owner.mutation(api.users.upsertUser, {})
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    await expect(owner.mutation(api.learnAdaptiveAccess.setLocalE2eEntitlement, { enabled: true })).rejects.toThrow(/unavailable/)
    await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })).rejects.toThrow(/approval/)
    process.env.CONVEX_CLOUD_URL = 'http://127.0.0.1:3210'
    await owner.mutation(api.users.upsertUser, {})
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'allowed' })
    await owner.mutation(api.learnAdaptiveAccess.setLocalE2eEntitlement, { enabled: false })
    await owner.mutation(api.users.upsertUser, {})
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    await owner.mutation(api.learnAdaptiveAccess.setLocalE2eEntitlement, { enabled: true })
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'allowed' })
    await expect(t.mutation(api.learnAdaptiveAccess.setLocalE2eEntitlement, { enabled: true })).rejects.toThrow(/denied/)
    await t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: OWNER.tokenIdentifier, status: 'active', phase: 'documents', startedAt: 1, updatedAt: 1 }))
    await expect(owner.mutation(api.learnAdaptiveAccess.setLocalE2eEntitlement, { enabled: true })).rejects.toThrow(/denied/)
    ADAPTIVE_ACTIVATION_CONFIGURATION.approval = syntheticReviewedActivationApproval()
    await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })).rejects.toThrow(/denied/)
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
  }
  finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
  }
})
