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
