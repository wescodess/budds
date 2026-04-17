/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_aaa',
  name: 'Alice',
  email: 'alice@example.com',
}
const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_bbb',
  name: 'Bob',
  email: 'bob@example.com',
}

function sampleCards() {
  return [
    {
      term: 'What is ATP?',
      definition: 'The energy currency of the cell.',
      metadata: {
        source: {
          filename: 'bio.pdf',
          chunkContent: 'ATP stores chemical energy.',
        },
      },
    },
    {
      term: 'Define photosynthesis',
      definition: 'Converting light energy into chemical energy.',
      metadata: {
        source: {
          filename: 'bio.pdf',
          chunkContent: 'Photosynthesis occurs in chloroplasts.',
        },
      },
    },
  ]
}

describe('flashcardRooms.createRoom', () => {
  test('[P0] rejects unauthenticated', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    await expect(
      t.mutation(api.flashcardRooms.createRoom, { folderId }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects on foreign folder with Folder not found', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'Private' })

    await expect(
      asB.mutation(api.flashcardRooms.createRoom, { folderId }),
    ).rejects.toThrow(/Folder not found/)
  })

  test('[P0] creates room with default title', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    const room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.title).toBe('Flash Cards')
    expect(room?.userId).toBe(USER_A.tokenIdentifier)
    expect(room?.folderId).toBe(folderId)
    expect(room?.activeVersionId).toBeUndefined()
    expect(typeof room?.updatedAt).toBe('number')
  })

  test('[P0] trims title and slices to 120', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, {
      folderId,
      title: '   Cell Biology Rapid Review   ',
    })
    const room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.title).toBe('Cell Biology Rapid Review')

    const long = 'a'.repeat(200)
    const { roomId: roomId2 } = await asUser.mutation(api.flashcardRooms.createRoom, {
      folderId,
      title: long,
    })
    const room2 = await t.run((ctx) => ctx.db.get(roomId2))
    expect(room2?.title.length).toBe(120)
  })

  test('[P0] blank title falls back to "Flash Cards"', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, {
      folderId,
      title: '   ',
    })
    const room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.title).toBe('Flash Cards')
  })
})

describe('flashcardRooms.renameRoom', () => {
  test('[P0] rejects unauthenticated', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    await expect(
      t.mutation(api.flashcardRooms.renameRoom, { roomId, title: 'New' }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] cross-user rename rejected with Room not found', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { roomId } = await asA.mutation(api.flashcardRooms.createRoom, { folderId })

    await expect(
      asB.mutation(api.flashcardRooms.renameRoom, { roomId, title: 'Hack' }),
    ).rejects.toThrow(/Room not found/)
  })

  test('[P0] trims + slices + falls back', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    await asUser.mutation(api.flashcardRooms.renameRoom, { roomId, title: '   ' })
    let room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.title).toBe('Flash Cards')

    await asUser.mutation(api.flashcardRooms.renameRoom, { roomId, title: '  Hello  ' })
    room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.title).toBe('Hello')
  })
})

describe('flashcardRooms.listRoomsByFolder', () => {
  test('[P0] returns only caller rooms newest-updated first', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderA = await asA.mutation(api.folders.createFolder, { name: 'A' })
    const folderB = await asB.mutation(api.folders.createFolder, { name: 'B' })

    const { roomId: r1 } = await asA.mutation(api.flashcardRooms.createRoom, { folderId: folderA, title: 'A1' })
    // delay
    await new Promise((r) => setTimeout(r, 2))
    const { roomId: r2 } = await asA.mutation(api.flashcardRooms.createRoom, { folderId: folderA, title: 'A2' })
    await asB.mutation(api.flashcardRooms.createRoom, { folderId: folderB, title: 'B1' })

    const rooms = await asA.query(api.flashcardRooms.listRoomsByFolder, { folderId: folderA })
    expect(rooms.map((r) => r._id)).toEqual([r2, r1])
    expect(rooms[0]!.cardCount).toBe(0)

    const crossAttempt = await asB.query(api.flashcardRooms.listRoomsByFolder, { folderId: folderA })
    expect(crossAttempt).toEqual([])
  })

  test('[P0] cardCount reflects current cards', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    await asUser.mutation(api.flashcardRooms.createCard, {
      roomId,
      term: 'Q',
      definition: 'A',
    })

    const rooms = await asUser.query(api.flashcardRooms.listRoomsByFolder, { folderId })
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.cardCount).toBe(1)
  })
})

describe('flashcardRooms.cardCount denormalized', () => {
  test('[P0] cardCount stays correct through create/delete/generate/restore cycle', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    let room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.cardCount).toBe(0)

    await asUser.mutation(api.flashcardRooms.createCard, { roomId, term: 'a', definition: '1' })
    const { cardId: c2 } = await asUser.mutation(api.flashcardRooms.createCard, { roomId, term: 'b', definition: '2' })
    room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.cardCount).toBe(2)

    await asUser.mutation(api.flashcardRooms.deleteCard, { cardId: c2 })
    room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.cardCount).toBe(1)

    const { versionId } = await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      title: 'Gen',
      cards: sampleCards(),
    })
    room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.cardCount).toBe(2)

    await asUser.mutation(api.flashcardRooms.restoreRoomVersion, { roomId, versionId })
    room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.cardCount).toBe(2)

    const listing = await asUser.query(api.flashcardRooms.listRoomsByFolder, { folderId })
    expect(listing[0]!.cardCount).toBe(2)
  })
})

describe('flashcardRooms.getRoom', () => {
  test('[P0] getRoom rejects callers with no identity', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    const result = await t.query(api.flashcardRooms.getRoom, { roomId })
    expect(result).toBeNull()
  })
})

describe('flashcardRooms.createCard', () => {
  test('[P0] rejects unauthenticated', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    await expect(
      t.mutation(api.flashcardRooms.createCard, { roomId, term: 'Q', definition: 'A' }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] foreign room → Room not found', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asA.mutation(api.flashcardRooms.createRoom, { folderId })

    await expect(
      asB.mutation(api.flashcardRooms.createCard, { roomId, term: 'Q', definition: 'A' }),
    ).rejects.toThrow(/Room not found/)
  })

  test('[P0] rejects empty term/def (trimmed)', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    await expect(
      asUser.mutation(api.flashcardRooms.createCard, { roomId, term: '   ', definition: 'x' }),
    ).rejects.toThrow(/Term required/)

    await expect(
      asUser.mutation(api.flashcardRooms.createCard, { roomId, term: 'x', definition: '   ' }),
    ).rejects.toThrow(/Definition required/)
  })

  test('[P0] appends with max+1 displayOrder and clears activeVersionId', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    await asUser.mutation(api.flashcardRooms.createCard, { roomId, term: 'a', definition: '1' })
    await asUser.mutation(api.flashcardRooms.createCard, { roomId, term: 'b', definition: '2' })
    await asUser.mutation(api.flashcardRooms.createCard, { roomId, term: 'c', definition: '3' })

    const view = await asUser.query(api.flashcardRooms.getRoom, { roomId })
    expect(view!.cards).toHaveLength(3)
    expect(view!.cards.map((c) => c.displayOrder)).toEqual([0, 1, 2])
    expect(view!.cards.map((c) => c.term)).toEqual(['a', 'b', 'c'])
  })
})

describe('flashcardRooms.updateCard', () => {
  test('[P0] rejects unauthenticated and cross-user', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asA.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId } = await asA.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'q', definition: 'a',
    })

    await expect(
      t.mutation(api.flashcardRooms.updateCard, { cardId, term: 'x', definition: 'y' }),
    ).rejects.toThrow(/Unauthenticated/)

    await expect(
      asB.mutation(api.flashcardRooms.updateCard, { cardId, term: 'x', definition: 'y' }),
    ).rejects.toThrow(/Card not found/)
  })

  test('[P0] blanks rejected', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'q', definition: 'a',
    })

    await expect(
      asUser.mutation(api.flashcardRooms.updateCard, { cardId, term: '  ', definition: 'ok' }),
    ).rejects.toThrow(/Term required/)

    await expect(
      asUser.mutation(api.flashcardRooms.updateCard, { cardId, term: 'ok', definition: '  ' }),
    ).rejects.toThrow(/Definition required/)
  })

  test('[P0] patches term + definition trimmed, clears activeVersionId', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'q', definition: 'a',
    })
    // simulate generation setting activeVersionId
    await t.run((ctx) => ctx.db.patch(roomId, { activeVersionId: undefined }))

    await asUser.mutation(api.flashcardRooms.updateCard, {
      cardId,
      term: '  new term  ',
      definition: '  new def  ',
    })
    const c = await t.run((ctx) => ctx.db.get(cardId))
    expect(c?.term).toBe('new term')
    expect(c?.definition).toBe('new def')

    const room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room?.activeVersionId).toBeUndefined()
  })
})

describe('flashcardRooms.deleteCard', () => {
  test('[P0] deletes without renumbering siblings, clears activeVersionId', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId: c1 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'a', definition: '1',
    })
    const { cardId: c2 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'b', definition: '2',
    })
    const { cardId: c3 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'c', definition: '3',
    })

    await asUser.mutation(api.flashcardRooms.deleteCard, { cardId: c2 })

    const view = await asUser.query(api.flashcardRooms.getRoom, { roomId })
    expect(view!.cards).toHaveLength(2)
    expect(view!.cards.map((c) => c.displayOrder)).toEqual([0, 2])
    expect(view!.cards.map((c) => c._id)).toEqual([c1, c3])
  })

  test('[P0] cross-user rejected uniform', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asA.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId } = await asA.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'q', definition: 'a',
    })

    await expect(
      asB.mutation(api.flashcardRooms.deleteCard, { cardId }),
    ).rejects.toThrow(/Card not found/)
  })
})

describe('flashcardRooms.reorderCards', () => {
  test('[P0] rejects if any cardId is foreign', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId: r1 } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { roomId: r2 } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId: r1c1 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId: r1, term: 'x', definition: 'y',
    })
    const { cardId: r2c1 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId: r2, term: 'a', definition: 'b',
    })

    await expect(
      asUser.mutation(api.flashcardRooms.reorderCards, {
        roomId: r1,
        order: [
          { cardId: r1c1, displayOrder: 0 },
          { cardId: r2c1, displayOrder: 1 },
        ],
      }),
    ).rejects.toThrow(/Invalid card/)

    // ensure nothing changed
    const view = await asUser.query(api.flashcardRooms.getRoom, { roomId: r1 })
    expect(view!.cards[0]!.displayOrder).toBe(0)
  })

  test('[P0] rejects partial list with Invalid reorder permutation', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId: c1 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'a', definition: '1',
    })
    await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'b', definition: '2',
    })

    await expect(
      asUser.mutation(api.flashcardRooms.reorderCards, {
        roomId,
        order: [{ cardId: c1, displayOrder: 0 }],
      }),
    ).rejects.toThrow(/Invalid reorder permutation/)
  })

  test('[P0] rejects duplicate displayOrder with Invalid reorder permutation', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId: c1 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'a', definition: '1',
    })
    const { cardId: c2 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'b', definition: '2',
    })

    await expect(
      asUser.mutation(api.flashcardRooms.reorderCards, {
        roomId,
        order: [
          { cardId: c1, displayOrder: 0 },
          { cardId: c2, displayOrder: 0 },
        ],
      }),
    ).rejects.toThrow(/Invalid reorder permutation/)
  })

  test('[P0] rejects missing-card (duplicate cardId) as Invalid reorder permutation', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId: c1 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'a', definition: '1',
    })
    await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'b', definition: '2',
    })

    await expect(
      asUser.mutation(api.flashcardRooms.reorderCards, {
        roomId,
        order: [
          { cardId: c1, displayOrder: 0 },
          { cardId: c1, displayOrder: 1 },
        ],
      }),
    ).rejects.toThrow(/Invalid reorder permutation/)
  })

  test('[P0] patches displayOrder in one call; clears activeVersionId', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { cardId: c1 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'a', definition: '1',
    })
    const { cardId: c2 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'b', definition: '2',
    })
    const { cardId: c3 } = await asUser.mutation(api.flashcardRooms.createCard, {
      roomId, term: 'c', definition: '3',
    })

    await asUser.mutation(api.flashcardRooms.reorderCards, {
      roomId,
      order: [
        { cardId: c3, displayOrder: 0 },
        { cardId: c1, displayOrder: 1 },
        { cardId: c2, displayOrder: 2 },
      ],
    })

    const view = await asUser.query(api.flashcardRooms.getRoom, { roomId })
    expect(view!.cards.map((c) => c._id)).toEqual([c3, c1, c2])
  })
})

describe('flashcardRooms.generateRoomCards', () => {
  test('[P0] archives current cards into a version, then replaces with new; sets activeVersionId', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    // 2 pre-existing cards
    await asUser.mutation(api.flashcardRooms.createCard, { roomId, term: 'old1', definition: 'a' })
    await asUser.mutation(api.flashcardRooms.createCard, { roomId, term: 'old2', definition: 'b' })

    const { versionId, cardCount } = await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      prompt: 'seed',
      requestedCardCount: 12,
      title: 'Gen 1',
      cards: sampleCards(),
    })

    expect(cardCount).toBe(2)

    const view = await asUser.query(api.flashcardRooms.getRoom, { roomId })
    expect(view!.room.activeVersionId).toBe(versionId)
    expect(view!.cards.map((c) => c.term)).toEqual(['What is ATP?', 'Define photosynthesis'])

    const versions = await asUser.query(api.flashcardRooms.listRoomVersions, { roomId })
    // 2 versions: archived "Previous deck" + new "Gen 1"
    expect(versions).toHaveLength(2)
    expect(versions[0]!.title).toBe('Gen 1')
    expect(versions[1]!.title).toBe('Flash Cards')

    const genVersion = await asUser.query(api.flashcardRooms.getRoomVersion, { versionId })
    expect(genVersion!.cards).toHaveLength(2)
  })

  test('[P0] archived version of gen-1 preserves origin:ai and real title', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      prompt: 'biology',
      title: 'Bio Gen 1',
      cards: sampleCards(),
    })

    await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      title: 'Bio Gen 2',
      cards: [{ term: 'New', definition: 'Card' }],
    })

    const versions = await asUser.query(api.flashcardRooms.listRoomVersions, { roomId })
    const archivedGen1 = versions.find((v) => v.title === 'Bio Gen 1')
    expect(archivedGen1).toBeDefined()
    expect(archivedGen1!.origin).toBe('ai')
    expect(archivedGen1!.prompt).toBe('biology')
  })

  test('[P0] on empty room, skips archive but still creates a version', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    const { versionId } = await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      cards: sampleCards(),
    })

    const versions = await asUser.query(api.flashcardRooms.listRoomVersions, { roomId })
    expect(versions).toHaveLength(1)
    expect(versions[0]!._id).toBe(versionId)
  })

  test('[P0] all-blank cards throws and leaves no phantom version', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    const versionsBefore = await asUser.query(api.flashcardRooms.listRoomVersions, { roomId })

    await expect(
      asUser.mutation(api.flashcardRooms.generateRoomCards, {
        roomId,
        origin: 'ai',
        cards: [
          { term: '  ', definition: '  ' },
          { term: '', definition: 'x' },
        ],
      }),
    ).rejects.toThrow(/Generation produced no valid cards/)

    const versionsAfter = await asUser.query(api.flashcardRooms.listRoomVersions, { roomId })
    expect(versionsAfter).toHaveLength(versionsBefore.length)
  })

  test('[P0] foreign room rejected', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asA.mutation(api.flashcardRooms.createRoom, { folderId })

    await expect(
      asB.mutation(api.flashcardRooms.generateRoomCards, {
        roomId,
        origin: 'ai',
        cards: sampleCards(),
      }),
    ).rejects.toThrow(/Room not found/)
  })
})

describe('flashcardRooms.listRoomVersions + getRoomVersion', () => {
  test('[P0] cross-user reads return [] / null', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asA.mutation(api.flashcardRooms.createRoom, { folderId })
    const { versionId } = await asA.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      cards: sampleCards(),
    })

    const listForeign = await asB.query(api.flashcardRooms.listRoomVersions, { roomId })
    expect(listForeign).toEqual([])

    const getForeign = await asB.query(api.flashcardRooms.getRoomVersion, { versionId })
    expect(getForeign).toBeNull()
  })
})

describe('flashcardRooms.restoreRoomVersion', () => {
  test('[P0] archives current then restores target version cards, sets activeVersionId', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    // Gen 1
    const { versionId: v1 } = await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      title: 'Gen 1',
      cards: [
        { term: 'g1a', definition: 'a', metadata: { source: { filename: 'x.pdf', chunkContent: '...' } } },
      ],
    })
    // Gen 2 overwrites
    await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      title: 'Gen 2',
      cards: [
        { term: 'g2a', definition: 'b', metadata: { source: { filename: 'y.pdf', chunkContent: '...' } } },
        { term: 'g2b', definition: 'c', metadata: { source: { filename: 'y.pdf', chunkContent: '...' } } },
      ],
    })

    // restore to v1
    const res = await asUser.mutation(api.flashcardRooms.restoreRoomVersion, {
      roomId,
      versionId: v1,
    })
    expect(res.cardCount).toBe(1)

    const view = await asUser.query(api.flashcardRooms.getRoom, { roomId })
    expect(view!.cards).toHaveLength(1)
    expect(view!.cards[0]!.term).toBe('g1a')
    expect(view!.room.activeVersionId).toBe(v1)
  })

  test('[P0] version belonging to different room rejected', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId: r1 } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { roomId: r2 } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    const { versionId: v1 } = await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId: r1,
      origin: 'ai',
      cards: sampleCards(),
    })

    await expect(
      asUser.mutation(api.flashcardRooms.restoreRoomVersion, {
        roomId: r2,
        versionId: v1,
      }),
    ).rejects.toThrow(/Version not found/)
  })

  test('[P0] no-op when restoring currently active version — version count unchanged', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    const { versionId } = await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      title: 'Gen 1',
      cards: sampleCards(),
    })

    const versionsBefore = await asUser.query(api.flashcardRooms.listRoomVersions, { roomId })

    const res = await asUser.mutation(api.flashcardRooms.restoreRoomVersion, {
      roomId,
      versionId,
    })
    expect(res.versionId).toBe(versionId)
    expect(res.cardCount).toBe(2)

    const versionsAfter = await asUser.query(api.flashcardRooms.listRoomVersions, { roomId })
    expect(versionsAfter.length).toBe(versionsBefore.length)
  })

  test('[P0] cross-user rejected', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asA.mutation(api.flashcardRooms.createRoom, { folderId })
    const { versionId } = await asA.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      cards: sampleCards(),
    })

    await expect(
      asB.mutation(api.flashcardRooms.restoreRoomVersion, { roomId, versionId }),
    ).rejects.toThrow(/Room not found/)
  })
})

describe('flashcardRooms.deleteRoom', () => {
  test('[P0] cascades current cards, version cards, versions, then room', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      cards: sampleCards(),
    })

    await asUser.mutation(api.flashcardRooms.deleteRoom, { roomId })

    const room = await t.run((ctx) => ctx.db.get(roomId))
    expect(room).toBeNull()

    const cards = await t.run((ctx) =>
      ctx.db.query('flashcardRoomCards').withIndex('by_roomId', (q) => q.eq('roomId', roomId)).collect(),
    )
    expect(cards).toEqual([])
    const vCards = await t.run((ctx) =>
      ctx.db.query('flashcardVersionCards').withIndex('by_roomId', (q) => q.eq('roomId', roomId)).collect(),
    )
    expect(vCards).toEqual([])
    const versions = await t.run((ctx) =>
      ctx.db.query('flashcardRoomVersions').withIndex('by_roomId', (q) => q.eq('roomId', roomId)).collect(),
    )
    expect(versions).toEqual([])
  })

  test('[P0] cross-user deleteRoom rejected', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'A' })
    const { roomId } = await asA.mutation(api.flashcardRooms.createRoom, { folderId })

    await expect(
      asB.mutation(api.flashcardRooms.deleteRoom, { roomId }),
    ).rejects.toThrow(/Room not found/)
  })
})
