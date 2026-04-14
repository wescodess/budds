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
      order: 0,
      front: 'What is ATP?',
      back: 'The energy currency of the cell.',
      sourceChunkContent: 'ATP stores chemical energy.',
      sourceFilename: 'bio.pdf',
    },
    {
      order: 1,
      front: 'Define photosynthesis',
      back: 'Converting light energy into chemical energy.',
      sourceChunkContent: 'Photosynthesis occurs in chloroplasts.',
      sourceFilename: 'bio.pdf',
    },
  ]
}

describe('flashcards.createSetWithCards', () => {
  test('[P0] rejects calls with no identity', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    await expect(
      t.mutation(api.flashcards.createSetWithCards, {
        folderId,
        title: 'Set',
        cards: sampleCards(),
      }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects when folder is owned by another user', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(USER_A)
    const asUserB = t.withIdentity(USER_B)

    const folderId = await asUserA.mutation(api.folders.createFolder, { name: 'Alice Private' })

    await expect(
      asUserB.mutation(api.flashcards.createSetWithCards, {
        folderId,
        title: 'Sneaky',
        cards: sampleCards(),
      }),
    ).rejects.toThrow(/Folder not found/)
  })

  test('[P0] persists set + cards with correct userId mirror and setId', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: 'Cell Bio',
      cards: sampleCards(),
    })

    const set = await t.run((ctx) => ctx.db.get(setId))
    expect(set?.userId).toBe(USER_A.tokenIdentifier)
    expect(set?.folderId).toBe(folderId)
    expect(set?.title).toBe('Cell Bio')
    expect(set?.cardCount).toBe(2)
    expect(set?.status).toBe('ready')

    const cards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )
    expect(cards).toHaveLength(2)
    expect(cards.every((c: any) => c.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(cards.every((c: any) => c.setId === setId)).toBe(true)
  })

  test('[P0] trims title and falls back to "Flash Cards" when blank', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: '   ',
      cards: sampleCards(),
    })

    const set = await t.run((ctx) => ctx.db.get(setId))
    expect(set?.title).toBe('Flash Cards')
  })
})

describe('flashcards.listByFolder', () => {
  test('[P0] only returns the caller sets for that folder', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(USER_A)
    const asUserB = t.withIdentity(USER_B)

    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'Alice' })
    const folderB = await asUserB.mutation(api.folders.createFolder, { name: 'Bob' })

    await asUserA.mutation(api.flashcards.createSetWithCards, {
      folderId: folderA,
      title: 'Alice Set',
      cards: sampleCards(),
    })
    await asUserB.mutation(api.flashcards.createSetWithCards, {
      folderId: folderB,
      title: 'Bob Set',
      cards: sampleCards(),
    })

    const alicesList = await asUserA.query(api.flashcards.listByFolder, { folderId: folderA })
    expect(alicesList).toHaveLength(1)
    expect(alicesList[0]!.title).toBe('Alice Set')
    expect(alicesList[0]!.cardCount).toBe(2)

    const crossAttempt = await asUserB.query(api.flashcards.listByFolder, { folderId: folderA })
    expect(crossAttempt).toEqual([])
  })
})

describe('flashcards.updateCard', () => {
  test('[P0] rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: 'Set',
      cards: sampleCards(),
    })
    const cards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )

    await expect(
      t.mutation(api.flashcards.updateCard, {
        cardId: cards[0]!._id,
        front: 'New',
        back: 'New',
      }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects when card belongs to another user', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asA.mutation(api.flashcards.createSetWithCards, {
      folderId: folderA,
      title: 'Alice',
      cards: sampleCards(),
    })
    const cards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )

    await expect(
      asB.mutation(api.flashcards.updateCard, {
        cardId: cards[0]!._id,
        front: 'Hack',
        back: 'Hack',
      }),
    ).rejects.toThrow(/Card not found/)
  })

  test('[P0] rejects empty front or back (trimmed)', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: 'Set',
      cards: sampleCards(),
    })
    const cards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )

    await expect(
      asUser.mutation(api.flashcards.updateCard, {
        cardId: cards[0]!._id,
        front: '   ',
        back: 'ok',
      }),
    ).rejects.toThrow(/Front text required/)

    await expect(
      asUser.mutation(api.flashcards.updateCard, {
        cardId: cards[0]!._id,
        front: 'ok',
        back: '   ',
      }),
    ).rejects.toThrow(/Back text required/)
  })

  test('[P0] updates only front + back, preserves source + order + owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: 'Set',
      cards: sampleCards(),
    })
    const cards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )
    const original = cards[0]!

    await asUser.mutation(api.flashcards.updateCard, {
      cardId: original._id,
      front: '  Updated front  ',
      back: 'Updated back',
    })

    const after = await t.run((ctx) => ctx.db.get(original._id))
    expect(after?.front).toBe('Updated front')
    expect(after?.back).toBe('Updated back')
    expect(after?.setId).toBe(original.setId)
    expect(after?.userId).toBe(original.userId)
    expect(after?.order).toBe(original.order)
    expect(after?.sourceDocumentId).toBe(original.sourceDocumentId)
    expect(after?.sourceChunkContent).toBe(original.sourceChunkContent)
    expect(after?.sourceFilename).toBe(original.sourceFilename)
  })
})

describe('flashcards.deleteCard', () => {
  test('[P0] rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: 'Set',
      cards: sampleCards(),
    })
    const cards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )

    await expect(
      t.mutation(api.flashcards.deleteCard, { cardId: cards[0]!._id }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects when card belongs to another user', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asA.mutation(api.flashcards.createSetWithCards, {
      folderId: folderA,
      title: 'Alice',
      cards: sampleCards(),
    })
    const cards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )

    await expect(
      asB.mutation(api.flashcards.deleteCard, { cardId: cards[0]!._id }),
    ).rejects.toThrow(/Card not found/)
  })

  test('[P0] removes card and decrements parent cardCount', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: 'Set',
      cards: sampleCards(),
    })
    const cards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )

    const result = await asUser.mutation(api.flashcards.deleteCard, {
      cardId: cards[0]!._id,
    })
    expect(result.setId).toBe(setId)
    expect(result.cardCount).toBe(1)

    const survivors = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )
    expect(survivors).toHaveLength(1)

    const set = await t.run((ctx) => ctx.db.get(setId))
    expect(set?.cardCount).toBe(1)
  })

  test('[P0] deleting last card leaves set with cardCount 0', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: 'Set',
      cards: sampleCards(),
    })
    const cards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )

    for (const c of cards) {
      await asUser.mutation(api.flashcards.deleteCard, { cardId: c._id })
    }

    const set = await t.run((ctx) => ctx.db.get(setId))
    expect(set?.cardCount).toBe(0)
    const survivors = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setId)).collect(),
    )
    expect(survivors).toHaveLength(0)
  })
})

describe('flashcards.deleteSet', () => {
  test('[P0] rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: 'Set',
      cards: sampleCards(),
    })

    await expect(
      t.mutation(api.flashcards.deleteSet, { setId }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects when set belongs to another user', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asA.mutation(api.flashcards.createSetWithCards, {
      folderId: folderA,
      title: 'Alice',
      cards: sampleCards(),
    })

    await expect(
      asB.mutation(api.flashcards.deleteSet, { setId }),
    ).rejects.toThrow(/Set not found/)
  })

  test('[P0] cascades child cards then parent set; siblings and other users untouched', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const folderB = await asB.mutation(api.folders.createFolder, { name: 'Bio' })

    const { setId: setA1 } = await asA.mutation(api.flashcards.createSetWithCards, {
      folderId: folderA,
      title: 'A1',
      cards: sampleCards(),
    })
    const { setId: setA2 } = await asA.mutation(api.flashcards.createSetWithCards, {
      folderId: folderA,
      title: 'A2',
      cards: sampleCards(),
    })
    const { setId: setB1 } = await asB.mutation(api.flashcards.createSetWithCards, {
      folderId: folderB,
      title: 'B1',
      cards: sampleCards(),
    })

    const result = await asA.mutation(api.flashcards.deleteSet, { setId: setA1 })
    expect(result.deletedCards).toBe(2)

    const deletedSet = await t.run((ctx) => ctx.db.get(setA1))
    expect(deletedSet).toBeNull()

    const deletedCards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setA1)).collect(),
    )
    expect(deletedCards).toEqual([])

    const siblingSet = await t.run((ctx) => ctx.db.get(setA2))
    expect(siblingSet).not.toBeNull()
    const siblingCards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setA2)).collect(),
    )
    expect(siblingCards).toHaveLength(2)

    const foreignSet = await t.run((ctx) => ctx.db.get(setB1))
    expect(foreignSet).not.toBeNull()
    const foreignCards = await t.run((ctx) =>
      ctx.db.query('flashcards').withIndex('by_setId', (q) => q.eq('setId', setB1)).collect(),
    )
    expect(foreignCards).toHaveLength(2)
  })
})

describe('flashcards.getSetWithCards', () => {
  test('[P0] returns null for a set owned by another user', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(USER_A)
    const asUserB = t.withIdentity(USER_B)

    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'Alice' })
    const { setId } = await asUserA.mutation(api.flashcards.createSetWithCards, {
      folderId: folderA,
      title: 'Private',
      cards: sampleCards(),
    })

    const result = await asUserB.query(api.flashcards.getSetWithCards, { id: setId })
    expect(result).toBeNull()
  })

  test('[P0] returns set + ordered cards for the owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { setId } = await asUser.mutation(api.flashcards.createSetWithCards, {
      folderId,
      title: 'Set',
      cards: sampleCards(),
    })

    const result = await asUser.query(api.flashcards.getSetWithCards, { id: setId })
    expect(result).not.toBeNull()
    expect(result!.set._id).toBe(setId)
    expect(result!.cards).toHaveLength(2)
    expect(result!.cards[0]!.order).toBe(0)
    expect(result!.cards[1]!.order).toBe(1)
  })
})
