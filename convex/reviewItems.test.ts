/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_ri_a',
  name: 'Alice',
  email: 'alice@ri.test',
}

const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_ri_b',
  name: 'Bob',
  email: 'bob@ri.test',
}

async function seedSectionWithFlashcards(t: ReturnType<typeof convexTest>) {
  const asUser = t.withIdentity(USER_A)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'RI Test Folder' })

  await t.run(async (ctx) => {
    await ctx.db.insert('documents', {
      userId: USER_A.tokenIdentifier,
      folderId,
      filename: 'test.pdf',
      status: 'success',
      fileSize: 1024,
    })
  })

  const { courseId } = await asUser.mutation(api.courses.create, {
    title: 'RI Test Course',
    sourceType: 'folder',
    folderId,
  })

  await asUser.mutation(api.courses.finalizeOutline, {
    courseId,
    outlineSections: [
      { title: 'Section 1', description: 'Desc', knowledgeType: 'factual', order: 0 },
    ],
    sourceConfidence: { docCount: 1, webPercent: 0 },
    totalSectionCount: 1,
  })

  const sections = await asUser.query(api.courseSections.listByCourse, { courseId })
  const sectionId = sections[0]!._id

  const roomId = await t.run(async (ctx) => {
    return await ctx.db.insert('flashcardRooms', {
      userId: USER_A.tokenIdentifier,
      folderId,
      title: 'Section Flashcards',
      updatedAt: Date.now(),
      courseScoped: true,
    })
  })

  const cardIds = await t.run(async (ctx) => {
    const ids = []
    ids.push(await ctx.db.insert('flashcardRoomCards', {
      roomId,
      userId: USER_A.tokenIdentifier,
      displayOrder: 0,
      term: 'Mitochondria',
      definition: 'The powerhouse of the cell',
    }))
    ids.push(await ctx.db.insert('flashcardRoomCards', {
      roomId,
      userId: USER_A.tokenIdentifier,
      displayOrder: 1,
      term: 'Nucleus',
      definition: 'Contains genetic material',
    }))
    ids.push(await ctx.db.insert('flashcardRoomCards', {
      roomId,
      userId: USER_A.tokenIdentifier,
      displayOrder: 2,
      term: 'Ribosome',
      definition: 'Protein synthesis machinery',
    }))
    return ids
  })

  await t.run(async (ctx) => {
    await ctx.db.patch(sectionId, {
      status: 'ready',
      contentBlocks: [
        { type: 'text' as const, content: 'Cell biology intro', order: 0 },
        { type: 'flashcard' as const, entityId: roomId, entityType: 'flashcard' as const, order: 1 },
      ],
    })
  })

  return { asUser, courseId, sectionId, folderId, roomId, cardIds }
}

describe('reviewItems.extractFromSection', () => {
  test('creates review items from flashcard cards on section completion', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId, cardIds } = await seedSectionWithFlashcards(t)

    const count: number = await t.mutation(internal.reviewItems.extractFromSection, {
      userId: USER_A.tokenIdentifier,
      courseId,
      sectionId,
    })

    expect(count).toBe(3)

    const items = await asUser.query(api.reviewItems.listBySection, { sectionId })
    expect(items).toHaveLength(3)

    const first = items.find((i) => i.prompt === 'Mitochondria')!
    expect(first.answer).toBe('The powerhouse of the cell')
    expect(first.easeFactor).toBe(2.5)
    expect(first.interval).toBe(1)
    expect(first.repetitions).toBe(0)
    expect(first.flagged).toBe(false)
    expect(first.courseId).toBe(courseId)
    expect(first.sectionId).toBe(sectionId)
    expect(first.flashcardRoomCardId).toBe(cardIds[0])
    expect(first.nextReviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('does not duplicate items on second extraction', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId } = await seedSectionWithFlashcards(t)

    await t.mutation(internal.reviewItems.extractFromSection, {
      userId: USER_A.tokenIdentifier,
      courseId,
      sectionId,
    })

    const secondCount: number = await t.mutation(internal.reviewItems.extractFromSection, {
      userId: USER_A.tokenIdentifier,
      courseId,
      sectionId,
    })

    expect(secondCount).toBe(0)

    const items = await asUser.query(api.reviewItems.listBySection, { sectionId })
    expect(items).toHaveLength(3)
  })

  test('inherits flagged status from flashcard card', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId, cardIds } = await seedSectionWithFlashcards(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(cardIds[1]!, { flagged: true })
    })

    await t.mutation(internal.reviewItems.extractFromSection, {
      userId: USER_A.tokenIdentifier,
      courseId,
      sectionId,
    })

    const items = await asUser.query(api.reviewItems.listBySection, { sectionId })
    const flaggedItem = items.find((i) => i.prompt === 'Nucleus')!
    expect(flaggedItem.flagged).toBe(true)

    const normalItem = items.find((i) => i.prompt === 'Mitochondria')!
    expect(normalItem.flagged).toBe(false)
  })

  test('returns 0 when section has no flashcard block', async () => {
    const t = convexTest(schema, modules)
    const { courseId, sectionId } = await seedSectionWithFlashcards(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sectionId, {
        contentBlocks: [
          { type: 'text' as const, content: 'Text only', order: 0 },
        ],
      })
    })

    const count: number = await t.mutation(internal.reviewItems.extractFromSection, {
      userId: USER_A.tokenIdentifier,
      courseId,
      sectionId,
    })

    expect(count).toBe(0)
  })
})

describe('reviewItems.listDueForUser', () => {
  test('returns items due today or earlier, excluding flagged', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId, cardIds } = await seedSectionWithFlashcards(t)

    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

    await t.run(async (ctx) => {
      await ctx.db.insert('reviewItems', {
        userId: USER_A.tokenIdentifier,
        courseId,
        sectionId,
        flashcardRoomCardId: cardIds[0]!,
        prompt: 'Due yesterday',
        answer: 'Answer 1',
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReviewDate: yesterday,
        flagged: false,
        createdAt: Date.now(),
      })
      await ctx.db.insert('reviewItems', {
        userId: USER_A.tokenIdentifier,
        courseId,
        sectionId,
        flashcardRoomCardId: cardIds[1]!,
        prompt: 'Due today',
        answer: 'Answer 2',
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReviewDate: today,
        flagged: false,
        createdAt: Date.now(),
      })
      await ctx.db.insert('reviewItems', {
        userId: USER_A.tokenIdentifier,
        courseId,
        sectionId,
        flashcardRoomCardId: cardIds[2]!,
        prompt: 'Due tomorrow',
        answer: 'Answer 3',
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReviewDate: tomorrow,
        flagged: false,
        createdAt: Date.now(),
      })
    })

    const due = await asUser.query(api.reviewItems.listDueForUser, {})
    const prompts = due.map((d) => d.prompt)
    expect(prompts).toContain('Due yesterday')
    expect(prompts).toContain('Due today')
    expect(prompts).not.toContain('Due tomorrow')
  })

  test('excludes flagged items from due list', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId, cardIds } = await seedSectionWithFlashcards(t)

    const today = new Date().toISOString().slice(0, 10)

    await t.run(async (ctx) => {
      await ctx.db.insert('reviewItems', {
        userId: USER_A.tokenIdentifier,
        courseId,
        sectionId,
        flashcardRoomCardId: cardIds[0]!,
        prompt: 'Normal item',
        answer: 'Answer',
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReviewDate: today,
        flagged: false,
        createdAt: Date.now(),
      })
      await ctx.db.insert('reviewItems', {
        userId: USER_A.tokenIdentifier,
        courseId,
        sectionId,
        flashcardRoomCardId: cardIds[1]!,
        prompt: 'Flagged item',
        answer: 'Answer',
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReviewDate: today,
        flagged: true,
        createdAt: Date.now(),
      })
    })

    const due = await asUser.query(api.reviewItems.listDueForUser, {})
    expect(due).toHaveLength(1)
    expect(due[0]!.prompt).toBe('Normal item')
  })

  test('returns empty for unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    await expect(t.query(api.reviewItems.listDueForUser, {})).rejects.toThrow('Unauthenticated')
  })
})

describe('reviewItems.listDueWithContext', () => {
  test('returns enriched items with course and section context', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId, cardIds } = await seedSectionWithFlashcards(t)

    const today = new Date().toISOString().slice(0, 10)

    await t.run(async (ctx) => {
      await ctx.db.insert('reviewItems', {
        userId: USER_A.tokenIdentifier,
        courseId,
        sectionId,
        flashcardRoomCardId: cardIds[0]!,
        prompt: 'Enriched item',
        answer: 'Answer',
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReviewDate: today,
        flagged: false,
        createdAt: Date.now(),
      })
    })

    const items = await asUser.query(api.reviewItems.listDueWithContext, {})
    expect(items).toHaveLength(1)
    expect(items[0]!.courseTitle).toBe('RI Test Course')
    expect(items[0]!.sectionTitle).toBe('Section 1')
    expect(items[0]!.sectionOrder).toBe(0)
    expect(items[0]!.prompt).toBe('Enriched item')
  })

  test('respects daily cap from learnProfile', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId } = await seedSectionWithFlashcards(t)

    const today = new Date().toISOString().slice(0, 10)

    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, { dailyReviewCap: 2 })
      }

      for (let i = 0; i < 5; i++) {
        await ctx.db.insert('reviewItems', {
          userId: USER_A.tokenIdentifier,
          courseId,
          sectionId,
          prompt: `Item ${i}`,
          answer: `Answer ${i}`,
          easeFactor: 2.5,
          interval: 1,
          repetitions: 0,
          nextReviewDate: today,
          flagged: false,
          createdAt: Date.now(),
        })
      }
    })

    const items = await asUser.query(api.reviewItems.listDueWithContext, {})
    expect(items).toHaveLength(2)
  })

  test('excludes flagged items', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId } = await seedSectionWithFlashcards(t)

    const today = new Date().toISOString().slice(0, 10)

    await t.run(async (ctx) => {
      await ctx.db.insert('reviewItems', {
        userId: USER_A.tokenIdentifier,
        courseId,
        sectionId,
        prompt: 'Not flagged',
        answer: 'A',
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReviewDate: today,
        flagged: false,
        createdAt: Date.now(),
      })
      await ctx.db.insert('reviewItems', {
        userId: USER_A.tokenIdentifier,
        courseId,
        sectionId,
        prompt: 'Flagged',
        answer: 'B',
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReviewDate: today,
        flagged: true,
        createdAt: Date.now(),
      })
    })

    const items = await asUser.query(api.reviewItems.listDueWithContext, {})
    expect(items).toHaveLength(1)
    expect(items[0]!.prompt).toBe('Not flagged')
  })
})

describe('reviewItems.listBySection', () => {
  test('returns items for a specific section', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId } = await seedSectionWithFlashcards(t)

    await t.mutation(internal.reviewItems.extractFromSection, {
      userId: USER_A.tokenIdentifier,
      courseId,
      sectionId,
    })

    const items = await asUser.query(api.reviewItems.listBySection, { sectionId })
    expect(items).toHaveLength(3)
    expect(items.every((i) => i.sectionId === sectionId)).toBe(true)
  })

  test('rejects access from non-owner', async () => {
    const t = convexTest(schema, modules)
    const { sectionId } = await seedSectionWithFlashcards(t)
    const asOther = t.withIdentity(USER_B)

    const items = await asOther.query(api.reviewItems.listBySection, { sectionId })
    expect(items).toEqual([])
  })
})

describe('completeSection creates review items', () => {
  test('completeSection populates review items from flashcard block', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sectionId } = await seedSectionWithFlashcards(t)

    const result = await asUser.mutation(api.courseSections.completeSection, {
      sectionId,
      practiceScore: 80,
      quizCorrect: 4,
      quizTotal: 5,
    })

    expect(result.conceptsForReview).toBe(3)

    const items = await asUser.query(api.reviewItems.listBySection, { sectionId })
    expect(items).toHaveLength(3)
  })
})

describe('flag sync between flashcards and review items', () => {
  test('flagging a flashcard flags the corresponding review item', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId, cardIds } = await seedSectionWithFlashcards(t)

    await t.mutation(internal.reviewItems.extractFromSection, {
      userId: USER_A.tokenIdentifier,
      courseId,
      sectionId,
    })

    await asUser.mutation(api.contentFlags.flagFlashcard, {
      cardId: cardIds[0]!,
      correctedDefinition: 'Actually the energy factory',
    })

    const items = await asUser.query(api.reviewItems.listBySection, { sectionId })
    const flaggedItem = items.find((i) => i.flashcardRoomCardId === cardIds[0])!
    expect(flaggedItem.flagged).toBe(true)
    expect(flaggedItem.correctedAnswer).toBe('Actually the energy factory')
  })

  test('unflagging a flashcard unflags the corresponding review item', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sectionId, cardIds } = await seedSectionWithFlashcards(t)

    await t.mutation(internal.reviewItems.extractFromSection, {
      userId: USER_A.tokenIdentifier,
      courseId,
      sectionId,
    })

    await asUser.mutation(api.contentFlags.flagFlashcard, {
      cardId: cardIds[0]!,
      correctedDefinition: 'Corrected',
    })

    await asUser.mutation(api.contentFlags.unflagFlashcard, {
      cardId: cardIds[0]!,
    })

    const items = await asUser.query(api.reviewItems.listBySection, { sectionId })
    const item = items.find((i) => i.flashcardRoomCardId === cardIds[0])!
    expect(item.flagged).toBe(false)
    expect(item.correctedAnswer).toBeUndefined()
  })
})
