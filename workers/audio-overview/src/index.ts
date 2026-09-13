import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import {
  geminiApiKeyConfigurationError,
  renderGeminiScene,
} from './gemini-audio-renderer'
import { cancelInterjection, renderInterjection } from './interjection-renderer'
import {
  isWorkflowActiveStatus,
  orchestrateAudioOverview,
  resolvePagesStageUrl,
  type AudioArtifactStore,
  type AudioOverviewWorkflowParams,
  type DurableStep,
  StageFailure,
  type StageCaller,
  type StepResult,
} from './orchestration'
import { transcribePcmScene, WORKERS_AI_TRANSCRIPTION_MODEL } from './workers-ai-transcriber'
import { deleteAllJobArtifacts } from './artifact-cleanup'

async function hashToken(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function tokenMatches(provided: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([hashToken(provided), hashToken(expected)])
  let mismatch = 0
  for (let index = 0; index < left.length; index++) mismatch |= left[index]! ^ right[index]!
  return mismatch === 0
}

async function callPagesStage(env: Env, params: AudioOverviewWorkflowParams, body: Parameters<StageCaller>[0]): Promise<StepResult> {
  const stageUrl = resolvePagesStageUrl(env.PAGES_BASE_URL)
  if (!stageUrl) {
    return { ok: false, retryable: false, message: 'Audio overview Pages callback is not configured' }
  }
  const response = await fetch(stageUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-budds-job-capability': params.capability,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    return {
      ok: false,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      message: `Pages stage endpoint failed (${response.status})`,
    }
  }
  return await response.json<StepResult>()
}

export class AudioOverviewWorkflow extends WorkflowEntrypoint<Env, AudioOverviewWorkflowParams> {
  async run(event: WorkflowEvent<AudioOverviewWorkflowParams>, step: WorkflowStep) {
    const params = event.payload
    const callStage: StageCaller = body => callPagesStage(this.env, params, body)
    const durableStep: DurableStep = {
      // WorkflowStep.do has a Serializable<T> generic wrapper that is stricter
      // than the small test seam used by the orchestration module. Call it
      // directly because WorkflowStep is an RPC receiver and its methods do
      // not support Function.prototype.bind in the Workers runtime.
      do<T>(name: string, config: Parameters<DurableStep['do']>[1], callback: () => Promise<T>) {
        return step.do(name, config as never, callback as never) as unknown as Promise<T>
      },
    }
    const artifacts: AudioArtifactStore = {
      head: async key => await this.env.AUDIO_ARTIFACTS.head(key),
      get: async key => await this.env.AUDIO_ARTIFACTS.get(key),
      put: async (key, value, options) => await this.env.AUDIO_ARTIFACTS.put(key, value, options),
    }
    try {
      const result = await orchestrateAudioOverview(
        durableStep,
        params,
        async (body) => {
          const result = await callStage(body)
          if (!result.ok && result.retryable === false) {
            throw new NonRetryableError(result.message || 'Audio overview stage failed')
          }
          return result
        },
        {
          artifacts,
          renderScene: scene => renderGeminiScene(scene, {
            fetch,
            config: { apiKey: this.env.GEMINI_API_KEY },
          }),
          transcribeScene: (pcm) => {
            if (!this.env.AI) throw new StageFailure('Workers AI transcription binding is unavailable', false)
            return transcribePcmScene(pcm, {
              run: async (_model, input) => await this.env.AI.run(WORKERS_AI_TRANSCRIPTION_MODEL, input),
            })
          },
        },
      )
      if (result.cancelled) {
        await step.do(
          'cleanup-cancelled-artifacts',
          { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '10 minutes' },
          async () => await deleteAllJobArtifacts(this.env.AUDIO_ARTIFACTS, params.jobId),
        )
      }
      return result
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Audio overview Workflow failed'
      try {
        await step.do(
          'record-failure',
          { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' },
          async () => {
            const result = await callStage({ jobId: params.jobId, stage: 'fail', error: message })
            if (!result.ok) throw new Error(result.message || 'Failed to record Workflow failure')
          },
        )
      }
      catch (recordError) {
        console.error('Audio overview failure state could not be recorded', recordError)
      }
      try {
        await step.do(
          'cleanup-failed-artifacts',
          { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '10 minutes' },
          async () => await deleteAllJobArtifacts(this.env.AUDIO_ARTIFACTS, params.jobId),
        )
      }
      catch (cleanupError) {
        console.error('Audio overview terminal R2 cleanup failed', cleanupError)
      }
      throw error
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const isStart = request.method === 'POST' && url.pathname === '/start'
    const isInterjectionRender = request.method === 'POST' && url.pathname === '/interjections/render'
    const isInterjectionCancel = request.method === 'DELETE' && url.pathname === '/interjections/render'
    if (!isStart && !isInterjectionRender && !isInterjectionCancel) return new Response('Not found', { status: 404 })
    const authorization = request.headers.get('Authorization')
    const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!provided || !env.AUDIO_OVERVIEW_WORKER_TOKEN || !await tokenMatches(provided, env.AUDIO_OVERVIEW_WORKER_TOKEN)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (isInterjectionRender || isInterjectionCancel) {
      if (!env.AUDIO_ARTIFACTS || (isInterjectionRender && !env.GEMINI_API_KEY)) {
        return Response.json({ error: 'Audio overview generation plane is not configured' }, { status: 503 })
      }
      const body = await request.json<any>().catch(() => null)
      try {
        if (isInterjectionCancel) {
          const result = await cancelInterjection(body, { bucket: env.AUDIO_ARTIFACTS })
          return Response.json(result)
        }
        const credentialError = geminiApiKeyConfigurationError(env.GEMINI_API_KEY)
        if (credentialError) return Response.json({ error: credentialError }, { status: 503 })
        const result = await renderInterjection(body, {
          bucket: env.AUDIO_ARTIFACTS,
          apiKey: env.GEMINI_API_KEY,
          fetch,
        })
        return Response.json(result, { status: result.duplicate ? 200 : 201 })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Interjection render failed'
        const status = /Invalid|requires|configured speaker|pause guidance/.test(message) ? 400 : /different evidence/.test(message) ? 409 : 502
        return Response.json({ error: message.slice(0, 500) }, { status })
      }
    }
    const body = await request.json<Partial<AudioOverviewWorkflowParams>>().catch(() => null)
    if (!body?.jobId || !/^[A-Za-z0-9_-]{43}$/.test(body.capability ?? '')) {
      return Response.json({ error: 'Invalid audio overview job' }, { status: 400 })
    }
    if (!resolvePagesStageUrl(env.PAGES_BASE_URL)) {
      return Response.json({ error: 'Audio overview Pages callback is not configured' }, { status: 503 })
    }
    if (!env.GEMINI_API_KEY || !env.AI || !env.AUDIO_ARTIFACTS) {
      return Response.json({ error: 'Audio overview generation plane is not configured' }, { status: 503 })
    }
    const credentialError = geminiApiKeyConfigurationError(env.GEMINI_API_KEY)
    if (credentialError) return Response.json({ error: credentialError }, { status: 503 })
    const id = `audio-${body.jobId}`
    try {
      await env.AUDIO_OVERVIEW_WORKFLOW.create({ id, params: { jobId: body.jobId, capability: body.capability! } })
      return Response.json({ accepted: true, duplicate: false, id }, { status: 202 })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/already exists|already been used|duplicate/i.test(message)) {
        const existing = await env.AUDIO_OVERVIEW_WORKFLOW.get(id)
        const details = await existing.status()
        if (isWorkflowActiveStatus(details.status)) {
          return Response.json({ accepted: true, duplicate: true, id }, { status: 202 })
        }
        return Response.json(
          { accepted: false, duplicate: true, id, error: 'Existing Workflow instance is terminal' },
          { status: 409 },
        )
      }
      throw error
    }
  },
} satisfies ExportedHandler<Env>
