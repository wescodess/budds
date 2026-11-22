import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { generateCompletion, lookupScoringGeneration, observeScoringProvenance, serializeCompletionRequest, validateGenerateResponse } from './ai-gateway'

const params = { model: 'fixture/old-model', messages: [{ role: 'user' as const, content: 'PRIVATE_LEARNER_BODY' }], maxAttempts: 1,
  allowProviderFallbacks: false, collectLogPayload: false, skipGatewayCache: true, requireZeroDataRetention: true, denyProviderDataCollection: true,
  jsonSchema: { name: 'fixture', strict: true, schema: { type: 'object' } } }
const response = () => ({ id: 'gen-fixture', model: 'fixture/old-model',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, cost: 0 },
  openrouter_metadata: { requested: 'fixture/old-model', strategy: 'direct', attempt: 1,
    summary: 'PRIVATE_SUMMARY', region: 'edge-region', endpoints: { available: [{ provider: 'Fixture Provider', model: 'fixture/old-model', selected: true }] },
    attempts: [{ provider: 'Fixture Provider', model: 'fixture/old-model', status: 200 }],
    pipeline: [{ type: 'response_healing', name: 'PRIVATE_NAME', data: { learner: 'PRIVATE_PIPELINE_BODY' } }] },
})

beforeEach(() => {
  vi.stubGlobal('useRuntimeConfig', () => ({ cloudflareAccountId: 'fixture-account', cloudflareAiGatewayId: 'fixture-gateway',
    openrouterApiKey: 'fixture-key', cloudflareAiGatewayApiKey: 'fixture-gateway-key' }))
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('allowlisted scoring provenance', () => {
  test('generic defaults and response shapes remain unchanged', async () => {
    const original = response()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(original)))
    expect(await generateCompletion(params)).toEqual(original)
    const init = vi.mocked(fetch).mock.calls[0]![1]!
    expect(init.headers).not.toHaveProperty('X-OpenRouter-Metadata')
    expect(init.body).toBe(serializeCompletionRequest(params))
  })

  test('scoring opt-in preserves inference body and strips every non-allowlisted field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(response())))
    const completion = await generateCompletion({ ...params, captureScoringProvenance: true })
    const init = vi.mocked(fetch).mock.calls[0]![1]!
    expect(init.headers).toMatchObject({ 'X-OpenRouter-Metadata': 'enabled', 'cf-aig-collect-log-payload': 'false', 'cf-aig-skip-cache': 'true', 'cf-aig-max-attempts': '1' })
    expect(init.body).toBe(serializeCompletionRequest(params))
    expect(completion.scoringProvenance).toMatchObject({ metadataValid: true, selectedModel: 'fixture/old-model', servingProvider: 'Fixture Provider',
      endpoint: null, revision: null, upstreamRequestId: null, fingerprint: null, attemptCount: 1,
      attempts: [{ provider: 'Fixture Provider', model: 'fixture/old-model', status: 200 }], pipelineTypes: ['response_healing'],
      usage: { inputTokens: 5, outputTokens: 2, costMicroUsd: 0 } })
    expect(JSON.stringify(completion)).not.toMatch(/PRIVATE_|edge-region/)
    expect(completion).not.toHaveProperty('openrouter_metadata')
  })

  test('missing fields stay explicit, and malformed observations never become proof', () => {
    expect(observeScoringProvenance({})).toMatchObject({ requestedModel: null, selectedModel: null, servingProvider: null, endpoint: null,
      revision: null, fingerprint: null, upstreamRequestId: null, usage: null, strategy: null, attemptCount: null, attempts: null, pipelineTypes: null, finishReason: null })
    expect(observeScoringProvenance({ openrouter_metadata: { attempt: '1' } }).metadataValid).toBe(false)
    expect(observeScoringProvenance({ provider: 'x'.repeat(201) }).metadataValid).toBe(false)
    expect(observeScoringProvenance({ usage: { prompt_tokens: -1, completion_tokens: 0 } }).usage).toBeNull()
    expect(observeScoringProvenance({ openrouter_metadata: { pipeline: [{ type: 'unrecognized', data: { response: 'private' } }] } }).pipelineTypes).toEqual(['unknown'])
  })

  test('requested selectors, candidate endpoints and edge regions are never selected upstream proof', () => {
    const observed = observeScoringProvenance({ openrouter_metadata: { requested: 'provider/region-variant', strategy: 'direct', region: 'iad',
      endpoints: { available: [{ provider: 'Candidate', model: 'fixture/old-model', selected: false }] } } })
    expect(observed.requestedModel).toBe('provider/region-variant')
    expect(observed.servingProvider).toBeNull()
    expect(observed.endpoint).toBeNull()
  })

  test('scoring envelopes reject ambiguous choices; a null refusal content is retained as refusal', () => {
    const ambiguous = response()
    ambiguous.choices.push(ambiguous.choices[0]!)
    expect(validateGenerateResponse(ambiguous, true).scoringProvenance.metadataValid).toBe(false)
    expect(validateGenerateResponse({ ...response(), choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null, refusal: 'PRIVATE_REFUSAL' } }] }, true).scoringProvenance?.refused).toBe(true)
  })
})

describe('generation metadata retrieval', () => {
  const generation = () => ({ data: { id: 'gen-fixture', model: 'fixture/old-model', provider_name: 'Fixture Provider', upstream_id: 'upstream-fixture',
    finish_reason: 'stop', native_finish_reason: 'stop', cancelled: false, tokens_prompt: 5, tokens_completion: 2, total_cost: 0.001,
    provider_responses: { prompt: 'PRIVATE_STORED_PROMPT' }, external_user: 'PRIVATE_USER', request_id: 'router-request', data_region: 'router-region' } })

  test('performs one bounded GET for the saved generation and never sends a body or gateway secret', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(generation())))
    const signal = new AbortController().signal
    const metadata = await lookupScoringGeneration('gen-fixture', signal)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://openrouter.ai/api/v1/generation?id=gen-fixture', {
      method: 'GET', headers: { Authorization: 'Bearer fixture-key' }, signal, redirect: 'error',
    })
    expect(metadata).toEqual({ generationId: 'gen-fixture', returnedModel: 'fixture/old-model', servingProvider: 'Fixture Provider', upstreamRequestId: 'upstream-fixture',
      finishReason: 'stop', nativeFinishReason: 'stop', cancelled: false, usage: { inputTokens: 5, outputTokens: 2, costMicroUsd: 1000 } })
    expect(JSON.stringify(metadata)).not.toMatch(/PRIVATE_|router-request|router-region/)
  })

  test('encodes the saved ID and keeps absent fields unavailable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'gen/?x&y' } })))
    const metadata = await lookupScoringGeneration('gen/?x&y', new AbortController().signal)
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/generation?id=gen%2F%3Fx%26y')
    expect(metadata).toMatchObject({ returnedModel: null, servingProvider: null, upstreamRequestId: null, usage: null, finishReason: null, cancelled: null })
  })

  test.each([
    [JSON.stringify({ data: { id: 'other-generation' } }), 200, /ID mismatch/],
    ['PRIVATE_UPSTREAM_ERROR', 503, /unavailable/],
    ['PRIVATE_INVALID_JSON', 200, /Invalid scoring generation metadata/],
    [JSON.stringify({ data: { id: 'gen-fixture', tokens_prompt: -1 } }), 200, /Invalid scoring generation metadata/],
    ['x'.repeat(32_001), 200, /byte limit/],
  ])('rejects invalid metadata with safe errors and no automatic retry', async (body, status, expected) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { status }))
    const failure = lookupScoringGeneration('gen-fixture', new AbortController().signal)
    await expect(failure).rejects.toThrow(expected)
    await expect(failure).rejects.not.toThrow('PRIVATE_')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('invalid IDs and aborted lookups make no request', async () => {
    await expect(lookupScoringGeneration('bad\nID', new AbortController().signal)).rejects.toThrow('Invalid scoring metadata lookup')
    await expect(lookupScoringGeneration('gen-fixture', AbortSignal.abort())).rejects.toThrow('Invalid scoring metadata lookup')
    expect(fetch).not.toHaveBeenCalled()
  })
})
