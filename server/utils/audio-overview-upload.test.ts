import { beforeEach, describe, expect, test, vi } from 'vitest'
import { uploadAudioOverviewBytes } from './audio-overview-upload'

vi.stubGlobal('createError', (opts: { statusCode: number, message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)

describe('uploadAudioOverviewBytes', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('[P0] binds bytes to the server nonce and retries idempotent completion', async () => {
    const mutation = vi.fn()
      .mockResolvedValueOnce({ claimId: 'claim_1', nonce: 'server-nonce' })
      .mockResolvedValueOnce({ uploadUrl: 'https://upload.example.com' })
    const action = vi.fn()
      .mockRejectedValueOnce(new Error('transient completion failure'))
      .mockResolvedValueOnce(null)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: 'storage_1' }),
    } as Response)
    const activeClaimIds: any[] = []

    const result = await uploadAudioOverviewBytes(
      { mutation, action } as any,
      'task_1' as any,
      new Uint8Array([1, 2, 3]),
      activeClaimIds,
    )

    expect(result).toEqual({ audioFileId: 'storage_1', uploadClaimId: 'claim_1' })
    expect(activeClaimIds).toEqual(['claim_1'])
    const uploaded = new Uint8Array(fetchMock.mock.calls[0]![1]!.body as ArrayBuffer)
    expect(new TextDecoder().decode(uploaded.slice(3))).toBe('\nBUDDS_UPLOAD_CLAIM:server-nonce\n')
    expect(mutation).toHaveBeenCalledTimes(2)
    expect(action.mock.calls.map(call => call[1])).toEqual([
      { claimId: 'claim_1', storageId: 'storage_1' },
      { claimId: 'claim_1', storageId: 'storage_1' },
    ])
  })

  test('[P0] preserves the claim id for caller cleanup when storage upload fails', async () => {
    const mutation = vi.fn()
      .mockResolvedValueOnce({ claimId: 'claim_2', nonce: 'server-nonce' })
      .mockResolvedValueOnce({ uploadUrl: 'https://upload.example.com' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      text: async () => 'try later',
    } as Response)
    const activeClaimIds: any[] = []

    const error = await uploadAudioOverviewBytes(
      { mutation, action: vi.fn() } as any,
      'task_2' as any,
      new Uint8Array([1, 2, 3]),
      activeClaimIds,
    ).catch(reason => reason)

    expect(error.statusCode).toBe(502)
    expect(activeClaimIds).toEqual(['claim_2'])
    expect(mutation).toHaveBeenCalledTimes(2)
  })

  test('[P1] invokes verified abort when every completion attempt fails', async () => {
    const mutation = vi.fn()
      .mockResolvedValueOnce({ claimId: 'claim_3', nonce: 'server-nonce' })
      .mockResolvedValueOnce({ uploadUrl: 'https://upload.example.com' })
    const action = vi.fn()
      .mockRejectedValueOnce(new Error('completion unavailable'))
      .mockRejectedValueOnce(new Error('completion unavailable'))
      .mockRejectedValueOnce(new Error('completion unavailable'))
      .mockResolvedValueOnce(null)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: 'storage_3' }),
    } as Response)
    const activeClaimIds: any[] = []

    await expect(uploadAudioOverviewBytes(
      { mutation, action } as any,
      'task_3' as any,
      new Uint8Array([1, 2, 3]),
      activeClaimIds,
    )).rejects.toThrow('completion unavailable')

    expect(action).toHaveBeenCalledTimes(4)
    expect(action.mock.calls[3]![1]).toEqual({ claimId: 'claim_3', storageId: 'storage_3' })
    expect(activeClaimIds).toEqual([])
  })
})
