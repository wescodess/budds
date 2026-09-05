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
})
