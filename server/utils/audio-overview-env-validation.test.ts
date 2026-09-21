import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []
const validator = resolve('scripts/validate-env.mjs')
const completeWorkerEnv = {
  ...process.env,
  AUDIO_OVERVIEW_WORKER_TOKEN: 'test-worker-token-with-sufficient-length',
  GEMINI_API_KEY: 'test-gemini-key',
  PAGES_BASE_URL: 'http://localhost:3002',
}
const completePagesEnv = {
  ...process.env,
  BETTER_AUTH_SECRET: 'test-better-auth-secret-with-sufficient-length',
  CONVEX_URL: 'https://example.convex.cloud',
  NUXT_PUBLIC_SITE_URL: 'https://budds.example',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  AUDIO_OVERVIEW_JOB_SECRET: 'test-audio-job-secret-with-sufficient-length',
  AUDIO_OVERVIEW_WORKER_TOKEN: 'test-worker-token-with-sufficient-length',
  CALENDAR_TOKEN_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  NUXT_LEARNING_DECISION_MODE: 'off',
  NUXT_LEARNING_DECISION_PROVIDER: '',
  NUXT_APPLICATION_ENVIRONMENT: 'development',
  CF_PAGES_ENVIRONMENT: 'preview',
  CF_PAGES_BRANCH: 'dev',
  NUXT_LAYA_EVALUATOR_TOKEN: '',
  NUXT_LAYA_EVALUATOR_URL: '',
  NUXT_QUIZ_SEMANTIC_LLM_MODEL: '',
}

function workspaceWithConfig(config: string) {
  const root = mkdtempSync(join(tmpdir(), 'budds-audio-env-'))
  temporaryDirectories.push(root)
  mkdirSync(join(root, 'workers/audio-overview'), { recursive: true })
  writeFileSync(join(root, 'workers/audio-overview/wrangler.jsonc'), config)
  return root
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Audio Overview Worker environment validation', () => {
  it('rejects a short orchestration credential', () => {
    const root = workspaceWithConfig(JSON.stringify({
      ai: { binding: 'AI' },
      r2_buckets: [{ binding: 'AUDIO_ARTIFACTS' }],
      workflows: [{ binding: 'AUDIO_OVERVIEW_WORKFLOW' }],
    }))
    const result = spawnSync(process.execPath, [validator, 'audio-workflow', '--strict'], {
      cwd: root,
      env: { ...completeWorkerEnv, AUDIO_OVERVIEW_WORKER_TOKEN: 'too-short' },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('at least 32 characters')
  })

  it('fails when the R2, Workers AI, or durable Workflow binding is absent', () => {
    const root = workspaceWithConfig('{ "r2_buckets": [{ "binding": "AUDIO_ARTIFACTS" }] }')
    const result = spawnSync(process.execPath, [validator, 'audio-workflow', '--strict'], {
      cwd: root,
      env: completeWorkerEnv,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('AI')
    expect(result.stderr).toContain('AUDIO_OVERVIEW_WORKFLOW')
  })

  it('rejects an OAuth access token supplied as the Gemini API key', () => {
    const root = workspaceWithConfig(JSON.stringify({
      ai: { binding: 'AI' },
      r2_buckets: [{ binding: 'AUDIO_ARTIFACTS' }],
      workflows: [{ binding: 'AUDIO_OVERVIEW_WORKFLOW' }],
    }))
    const result = spawnSync(process.execPath, [validator, 'audio-workflow', '--strict'], {
      cwd: root,
      env: { ...completeWorkerEnv, GEMINI_API_KEY: 'ya29.example-oauth-access-token' },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Google AI Studio API key, not an OAuth access token')
  })

  it('accepts the complete no-network generation plane contract', () => {
    const root = workspaceWithConfig(JSON.stringify({
      ai: { binding: 'AI' },
      r2_buckets: [{ binding: 'AUDIO_ARTIFACTS' }],
      workflows: [{ binding: 'AUDIO_OVERVIEW_WORKFLOW' }],
    }))

    expect(() => execFileSync(process.execPath, [validator, 'audio-workflow', '--strict'], {
      cwd: root,
      env: completeWorkerEnv,
      stdio: 'pipe',
    })).not.toThrow()
  })
})

describe('Cloudflare Pages environment validation', () => {
  it('requires the public origin and Google OAuth configuration', () => {
    const result = spawnSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_PUBLIC_SITE_URL: '',
        SITE_URL: '',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
      },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Public application origin')
    expect(result.stderr).toContain('Google OAuth client id')
    expect(result.stderr).toContain('Google OAuth client secret')
  })

  it('rejects malformed application and Convex URLs', () => {
    const result = spawnSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_PUBLIC_SITE_URL: 'not-a-url',
        CONVEX_URL: 'also-not-a-url',
      },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must be an HTTP(S) URL')
  })

  it('accepts the complete production Pages contract', () => {
    expect(() => execFileSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: completePagesEnv,
      stdio: 'pipe',
    })).not.toThrow()
  })

  it('accepts Cloudflare Pages deployment URL as the preview origin', () => {
    expect(() => execFileSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_PUBLIC_SITE_URL: '',
        SITE_URL: '',
        CF_PAGES_URL: 'https://feature-branch.budds.pages.dev',
      },
      stdio: 'pipe',
    })).not.toThrow()
  })

  it('accepts a complete Laya shadow configuration', () => {
    expect(() => execFileSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_LEARNING_DECISION_MODE: 'shadow',
        NUXT_LEARNING_DECISION_PROVIDER: 'laya',
        NUXT_LAYA_EVALUATOR_TOKEN: 'test-laya-token-with-sufficient-length',
        NUXT_LAYA_EVALUATOR_URL: 'http://localhost:8788',
        NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough',
      },
      stdio: 'pipe',
    })).not.toThrow()
  })

  it('accepts a complete structured LLM shadow configuration', () => {
    expect(() => execFileSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_LEARNING_DECISION_MODE: 'shadow',
        NUXT_LEARNING_DECISION_PROVIDER: 'structured-llm',
        NUXT_QUIZ_SEMANTIC_LLM_MODEL: 'openai/gpt-4o-mini',
        NUXT_CLOUDFLARE_ACCOUNT_ID: 'account',
        NUXT_CLOUDFLARE_AI_GATEWAY_ID: 'gateway',
        NUXT_OPENROUTER_API_KEY: 'openrouter-key',
        NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough',
      },
      stdio: 'pipe',
    })).not.toThrow()
  })

  it('allows feature-branch preview builds while runtime keeps shadow execution dev-only', () => {
    expect(() => execFileSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_LEARNING_DECISION_MODE: 'shadow',
        NUXT_LEARNING_DECISION_PROVIDER: 'structured-llm',
        NUXT_QUIZ_SEMANTIC_LLM_MODEL: 'openai/gpt-4o-mini',
        NUXT_CLOUDFLARE_ACCOUNT_ID: 'account',
        NUXT_CLOUDFLARE_AI_GATEWAY_ID: 'gateway',
        NUXT_OPENROUTER_API_KEY: 'openrouter-key',
        NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough',
        NUXT_APPLICATION_ENVIRONMENT: 'development',
        CF_PAGES_ENVIRONMENT: 'preview',
        CF_PAGES_BRANCH: 'feat/safe-preview-build',
      },
      stdio: 'pipe',
    })).not.toThrow()
  })

  it('rejects structured LLM shadow execution on a production deployment', () => {
    const result = spawnSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_LEARNING_DECISION_MODE: 'shadow',
        NUXT_LEARNING_DECISION_PROVIDER: 'structured-llm',
        NUXT_QUIZ_SEMANTIC_LLM_MODEL: 'openai/gpt-4o-mini',
        NUXT_CLOUDFLARE_ACCOUNT_ID: 'account',
        NUXT_CLOUDFLARE_AI_GATEWAY_ID: 'gateway',
        NUXT_OPENROUTER_API_KEY: 'openrouter-key',
        NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough',
        NUXT_APPLICATION_ENVIRONMENT: 'production',
        CF_PAGES_ENVIRONMENT: 'production',
        CF_PAGES_BRANCH: 'main',
      },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Shadow learning decisions are development-only')
  })

  it('rejects structured LLM advisory mode until it has separate calibration approval', () => {
    const result = spawnSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_LEARNING_DECISION_MODE: 'advisory',
        NUXT_LEARNING_DECISION_PROVIDER: 'structured-llm',
        NUXT_QUIZ_SEMANTIC_LLM_MODEL: 'openai/gpt-4o-mini',
        NUXT_CLOUDFLARE_ACCOUNT_ID: 'account',
        NUXT_CLOUDFLARE_AI_GATEWAY_ID: 'gateway',
        NUXT_OPENROUTER_API_KEY: 'openrouter-key',
        NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough',
      },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Structured LLM grading is shadow-only')
  })

  it.each([
    ['missing model', { NUXT_QUIZ_SEMANTIC_LLM_MODEL: '' }, 'model is required'],
    ['unapproved model', { NUXT_QUIZ_SEMANTIC_LLM_MODEL: 'openai/unapproved' }, 'model is not approved'],
    ['missing gateway', { NUXT_CLOUDFLARE_AI_GATEWAY_ID: '', CLOUDFLARE_AI_GATEWAY_ID: '' }, 'AI Gateway id is required'],
    ['missing OpenRouter key', { NUXT_OPENROUTER_API_KEY: '', OPENROUTER_API_KEY: '' }, 'OpenRouter key is required'],
  ])('rejects structured LLM shadow configuration with %s', (_name, overrides, message) => {
    const result = spawnSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_LEARNING_DECISION_MODE: 'shadow',
        NUXT_LEARNING_DECISION_PROVIDER: 'structured-llm',
        NUXT_QUIZ_SEMANTIC_LLM_MODEL: 'openai/gpt-4o-mini',
        NUXT_CLOUDFLARE_ACCOUNT_ID: 'account',
        NUXT_CLOUDFLARE_AI_GATEWAY_ID: 'gateway',
        NUXT_OPENROUTER_API_KEY: 'openrouter-key',
        NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough',
        ...overrides,
      },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })

  it('rejects Laya advisory configuration until the committed calibration manifest is approved', () => {
    const result = spawnSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: {
        ...completePagesEnv,
        NUXT_LEARNING_DECISION_MODE: 'advisory',
        NUXT_LEARNING_DECISION_PROVIDER: 'laya',
        NUXT_LAYA_EVALUATOR_TOKEN: 'test-laya-token-with-sufficient-length',
        NUXT_LAYA_EVALUATOR_URL: 'http://localhost:8788',
        NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough',
        NUXT_QUIZ_SEMANTIC_ACTIVATION_MANIFEST: 'quiz-semantic-advisory.v1',
      },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('requires the committed approved calibration manifest')
  })

  it.each([
    ['invalid mode', { NUXT_LEARNING_DECISION_MODE: 'enforced' }, 'mode must be off, shadow, or advisory'],
    ['invalid provider', { NUXT_LEARNING_DECISION_MODE: 'shadow', NUXT_LEARNING_DECISION_PROVIDER: 'other', NUXT_LAYA_EVALUATOR_TOKEN: 'test-laya-token-with-sufficient-length', NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough' }, 'provider must be laya or structured-llm'],
    ['short token', { NUXT_LEARNING_DECISION_MODE: 'shadow', NUXT_LEARNING_DECISION_PROVIDER: 'laya', NUXT_LAYA_EVALUATOR_TOKEN: 'short', NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough' }, 'at least 32 characters'],
    ['malformed URL', { NUXT_LEARNING_DECISION_MODE: 'shadow', NUXT_LEARNING_DECISION_PROVIDER: 'laya', NUXT_LAYA_EVALUATOR_TOKEN: 'test-laya-token-with-sufficient-length', NUXT_LAYA_EVALUATOR_URL: 'not-a-url', NUXT_QUIZ_ASSESSMENT_WRITE_SECRET: 'test-assessment-write-secret-long-enough' }, 'must be an HTTP(S) URL'],
    ['missing advisory write secret', { NUXT_LEARNING_DECISION_MODE: 'advisory', NUXT_LEARNING_DECISION_PROVIDER: 'laya', NUXT_LAYA_EVALUATOR_TOKEN: 'test-laya-token-with-sufficient-length' }, 'write credential must be at least 32 characters'],
  ])('rejects %s for Laya shadow mode', (_name, overrides, message) => {
    const result = spawnSync(process.execPath, [validator, 'build', '--strict'], {
      cwd: process.cwd(),
      env: { ...completePagesEnv, ...overrides },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })
})
