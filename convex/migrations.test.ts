/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_aaa',
  name: 'Alice',
  email: 'alice@example.com',
}

async function seedLegacySet(
  t: ReturnType<typeof convexTest>,
  userId: string,
  folderId: any,
  title: string,
  cards: Array<{ order: number; front: string; back: string; sourceChunkContent: string; sourceFilename: string }>,
) {
  const setId = await t.run(async (ctx) => {
    return await ctx.db.insert('flashcardSets', {
      userId,
      folderId,
      title,
      status: 'ready',
      cardCount: cards.length,
    })
  })

  for (const c of cards) {
    await t.run(async (ctx) => {
      await ctx.db.insert('flashcards', {
        setId,
        userId,
        order: c.order,
        front: c.front,
        back: c.back,
        sourceChunkContent: c.sourceChunkContent,
        sourceFilename: c.sourceFilename,
      })
    })
  }

  return { setId }
}

function legacyCards() {
  return [
    {
      order: 0,
      front: 'What is ATP?',
      back: 'Energy currency.',
      sourceChunkContent: 'ATP stores chemical energy.',
      sourceFilename: 'bio.pdf',
    },
    {
      order: 1,
      front: 'Define mitosis',
      back: 'Cell division for growth.',
      sourceChunkContent: 'Mitosis produces identical daughters.',
      sourceFilename: 'bio.pdf',
    },
  ]
}

describe('migrations.migrateLegacyFlashcards', () => {
  test('[P0] copies each legacy set → room + initial version + cards on both sides', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { setId } = await seedLegacySet(t, USER_A.tokenIdentifier, folderId, 'Cell Biology', legacyCards())

    const result = await t.mutation(internal.migrations.migrateLegacyFlashcards, {})
    expect(result.migratedRooms).toBe(1)
    expect(result.skippedOrphans).toBe(0)
    expect(result.skippedAlreadyMigrated).toBe(0)

    const rooms = await asUser.query(api.flashcardRooms.listRoomsByFolder, { folderId })
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.title).toBe('Cell Biology')
    expect(rooms[0]!.cardCount).toBe(2)

    const view = await asUser.query(api.flashcardRooms.getRoom, { roomId: rooms[0]!._id })
    expect(view!.cards.map((c) => c.term)).toEqual(['What is ATP?', 'Define mitosis'])
    expect(view!.cards.map((c) => c.definition)).toEqual(['Energy currency.', 'Cell division for growth.'])
    expect(view!.cards[0]!.metadata?.source?.filename).toBe('bio.pdf')
    expect(view!.cards[0]!.metadata?.source?.chunkContent).toBe('ATP stores chemical energy.')
    expect(view!.room.migratedFromSetId).toBe(setId)
    expect(view!.room.legacyCreatedAt).toBeGreaterThan(0)
    expect(view!.room.activeVersionId).toBeDefined()

    const versions = await asUser.query(api.flashcardRooms.listRoomVersions, { roomId: rooms[0]!._id })
    expect(versions).toHaveLength(1)
    expect(versions[0]!.title).toBe('Cell Biology')
    expect(versions[0]!.origin).toBe('ai')
    expect(versions[0]!.cardCount).toBe(2)

    const versionView = await asUser.query(api.flashcardRooms.getRoomVersion, {
      versionId: versions[0]!._id,
    })
    expect(versionView!.cards.map((c) => c.term)).toEqual(['What is ATP?', 'Define mitosis'])
  })

  test('[P0] idempotent — second run does not duplicate', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    await seedLegacySet(t, USER_A.tokenIdentifier, folderId, 'Cell Biology', legacyCards())

    const r1 = await t.mutation(internal.migrations.migrateLegacyFlashcards, {})
    expect(r1.migratedRooms).toBe(1)

    const r2 = await t.mutation(internal.migrations.migrateLegacyFlashcards, {})
    expect(r2.migratedRooms).toBe(0)
    expect(r2.skippedAlreadyMigrated).toBe(1)

    const rooms = await asUser.query(api.flashcardRooms.listRoomsByFolder, { folderId })
    expect(rooms).toHaveLength(1)
  })

  test('[P0] skips mismatched-owner legacy card rows', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { setId } = await seedLegacySet(t, USER_A.tokenIdentifier, folderId, 'Mixed', legacyCards())

    const allCards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )
    await t.run((ctx) => ctx.db.patch(allCards[0]!._id, { userId: 'other-user' }))

    const result = await t.mutation(internal.migrations.migrateLegacyFlashcards, {})
    expect(result.migratedRooms).toBe(1)
    expect(result.skippedOrphanCards).toBe(1)

    const rooms = await asUser.query(api.flashcardRooms.listRoomsByFolder, { folderId })
    const view = await asUser.query(api.flashcardRooms.getRoom, { roomId: rooms[0]!._id })
    expect(view!.cards).toHaveLength(1)
    expect(view!.cards[0]!.term).toBe('Define mitosis')
  })

  test('[P0] skips legacy set whose folder is owned by different user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await seedLegacySet(t, USER_A.tokenIdentifier, folderId, 'Set', legacyCards())

    await t.run((ctx) => ctx.db.patch(folderId, { userId: 'other-user' }))

    const result = await t.mutation(internal.migrations.migrateLegacyFlashcards, {})
    expect(result.migratedRooms).toBe(0)
    expect(result.skippedOrphans).toBe(1)

    const rooms = await t.run((ctx) =>
      ctx.db.query('flashcardRooms').withIndex('by_migratedFromSetId', (q) => q.eq('migratedFromSetId', setId)).collect(),
    )
    expect(rooms).toEqual([])
  })
})
