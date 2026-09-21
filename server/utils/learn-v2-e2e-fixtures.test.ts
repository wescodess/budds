import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  deterministicLearnV2Completion,
  deterministicLearnV2FolderEvidence,
  deterministicLearnV2FolderUpload,
  LEARN_V2_E2E_FOLDER_FIXTURE_FILENAME,
  LEARN_V2_E2E_FOLDER_FIXTURE_TEXT,
} from './learn-v2-e2e-fixtures'

const env = { NODE_ENV: 'test', BUDDS_E2E_MODE: 'true', BUDDS_E2E_AUTH_TOKEN: 'x'.repeat(32), CONVEX_SITE_URL: 'http://127.0.0.1:3211' }

afterEach(() => vi.unstubAllEnvs())

describe('Learn V2 local browser fixtures', () => {
  test('admits only the exact uploaded folder fixture on disposable local Convex', async () => {
    const bytes = new TextEncoder().encode(LEARN_V2_E2E_FOLDER_FIXTURE_TEXT)
    const admitted = await deterministicLearnV2FolderUpload(LEARN_V2_E2E_FOLDER_FIXTURE_FILENAME, bytes, env)
    expect(admitted?.contentHash).toMatch(/^[a-f0-9]{64}$/)
    await expect(deterministicLearnV2FolderUpload('other.md', bytes, env)).resolves.toBeNull()
    await expect(deterministicLearnV2FolderUpload(LEARN_V2_E2E_FOLDER_FIXTURE_FILENAME, new TextEncoder().encode('different'), env)).resolves.toBeNull()
    await expect(deterministicLearnV2FolderUpload(LEARN_V2_E2E_FOLDER_FIXTURE_FILENAME, bytes, { ...env, CONVEX_SITE_URL: 'https://prod.example.com' })).resolves.toBeNull()
  })

  test('returns evidence only for the exact fixture provenance', async () => {
    const admitted = await deterministicLearnV2FolderUpload(LEARN_V2_E2E_FOLDER_FIXTURE_FILENAME, new TextEncoder().encode(LEARN_V2_E2E_FOLDER_FIXTURE_TEXT), env)
    expect(admitted).not.toBeNull()
    const evidence = await deterministicLearnV2FolderEvidence([{ alias: 'source-001', ...admitted! }], env)
    expect(evidence?.get('source-001')).toContain('velocity changes')
    await expect(deterministicLearnV2FolderEvidence([{ alias: 'source-001', contentHash: 'bad', sourceRevision: admitted!.sourceRevision }], env)).resolves.toBeNull()
    await expect(deterministicLearnV2FolderEvidence([{ alias: 'source-001', ...admitted! }], { ...env, BUDDS_E2E_MODE: 'false' })).resolves.toBeNull()
  })

  test('keeps provider prose out of the deterministic mastery result', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BUDDS_E2E_MODE', 'true')
    vi.stubEnv('BUDDS_E2E_AUTH_TOKEN', 'x'.repeat(32))
    const completion = deterministicLearnV2Completion({
      model: 'e2e',
      messages: [{ role: 'user', content: JSON.stringify({ rubric: { criteria: [{ key: 'supported-explanation' }] } }) }],
      jsonSchema: { name: 'learn_v2_mastery_score', schema: {} },
    })

    const result = JSON.parse(completion!.choices[0]!.message.content)
    expect(Object.keys(result).sort()).toEqual(['criterionResults', 'misconceptionTags'])
    expect(result.criterionResults).toEqual([{ key: 'supported-explanation', awarded: true }])

    const calibration = deterministicLearnV2Completion({
      model: 'e2e',
      messages: [{ role: 'user', content: JSON.stringify({ objective: { assessmentContract: { criteria: [{ key: 'supported-explanation' }] } } }) }],
      jsonSchema: { name: 'learn_v2_calibration_score', schema: {} },
    })
    expect(JSON.parse(calibration!.choices[0]!.message.content).criterionResults).toEqual([{
      key: 'supported-explanation',
      awarded: true,
      rationale: 'Supported by the deterministic accepted evidence.',
    }])
  })
})
