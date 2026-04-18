import { describe, it, expect } from 'vitest'
import { createAudioOverviewPlayback, type AudioOverviewTurn } from '~/composables/useAudioOverviewStore'
import type { Id } from '../../../convex/_generated/dataModel'

function makeTurn(speaker: 'host_a' | 'host_b', index: number, duration = 1000): AudioOverviewTurn {
  return {
    speaker,
    text: `Turn ${index}`,
    audioFileId: `file_${index}` as unknown as Id<'_storage'>,
    durationMs: duration,
  }
}

describe('useAudioOverviewStore — spliceTurns', () => {
  it('inserts turns after the given index and shifts the rest', () => {
    const s = createAudioOverviewPlayback()
    s.loadOverview({
      overviewId: 'ov1' as unknown as Id<'audioOverviews'>,
      folderId: 'f1' as unknown as Id<'folders'>,
      title: 'Test',
      turns: [makeTurn('host_a', 1), makeTurn('host_b', 2), makeTurn('host_a', 3)],
      turnUrls: ['u1', 'u2', 'u3'],
    })

    s.spliceTurns({
      afterIndex: 0,
      turns: [makeTurn('host_b', 99, 2000)],
      turnUrls: ['u99'],
    })

    expect(s.turns.value.length).toBe(4)
    expect(s.turns.value[1]!.text).toBe('Turn 99')
    expect(s.turnUrls.value[1]).toBe('u99')
    // original turn 2 now at index 2
    expect(s.turns.value[2]!.text).toBe('Turn 2')
  })

  it('appends when afterIndex equals last index', () => {
    const s = createAudioOverviewPlayback()
    s.loadOverview({
      overviewId: 'ov2' as unknown as Id<'audioOverviews'>,
      folderId: 'f1' as unknown as Id<'folders'>,
      title: 'Test',
      turns: [makeTurn('host_a', 1), makeTurn('host_b', 2)],
      turnUrls: ['u1', 'u2'],
    })

    s.spliceTurns({
      afterIndex: 1,
      turns: [makeTurn('host_a', 10), makeTurn('host_b', 11)],
      turnUrls: ['u10', 'u11'],
    })

    expect(s.turns.value.length).toBe(4)
    expect(s.turns.value[2]!.text).toBe('Turn 10')
    expect(s.turns.value[3]!.text).toBe('Turn 11')
    expect(s.turnUrls.value[2]).toBe('u10')
  })

  it('clamps afterIndex above the last turn to insert at the end', () => {
    const s = createAudioOverviewPlayback()
    s.loadOverview({
      overviewId: 'ov3' as unknown as Id<'audioOverviews'>,
      folderId: 'f1' as unknown as Id<'folders'>,
      title: 'Test',
      turns: [makeTurn('host_a', 1)],
      turnUrls: ['u1'],
    })

    s.spliceTurns({
      afterIndex: 999,
      turns: [makeTurn('host_b', 2)],
      turnUrls: ['u2'],
    })

    expect(s.turns.value.length).toBe(2)
    expect(s.turns.value[1]!.text).toBe('Turn 2')
  })

  it('is a no-op when turns/urls arrays mismatch', () => {
    const s = createAudioOverviewPlayback()
    s.loadOverview({
      overviewId: 'ov4' as unknown as Id<'audioOverviews'>,
      folderId: 'f1' as unknown as Id<'folders'>,
      title: 'Test',
      turns: [makeTurn('host_a', 1)],
      turnUrls: ['u1'],
    })

    s.spliceTurns({
      afterIndex: 0,
      turns: [makeTurn('host_b', 2), makeTurn('host_a', 3)],
      turnUrls: ['u2'],
    })

    expect(s.turns.value.length).toBe(1)
  })

  it('is a no-op on empty inserts', () => {
    const s = createAudioOverviewPlayback()
    s.loadOverview({
      overviewId: 'ov5' as unknown as Id<'audioOverviews'>,
      folderId: 'f1' as unknown as Id<'folders'>,
      title: 'Test',
      turns: [makeTurn('host_a', 1)],
      turnUrls: ['u1'],
    })
    s.spliceTurns({ afterIndex: 0, turns: [], turnUrls: [] })
    expect(s.turns.value.length).toBe(1)
  })
})
