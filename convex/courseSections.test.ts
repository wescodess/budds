/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { transitionMastery, type MasteryState } from './lib/masteryStateMachine'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_cs_a',
  name: 'Alice',
  email: 'alice@example.com',
}

const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_cs_b',
  name: 'Bob',
  email: 'bob@example.com',
}

async function seedCourseWithSections(t: ReturnType<typeof convexTest>) {
  const asUser = t.withIdentity(USER_A)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test Folder' })

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
    title: 'Test Course',
    sourceType: 'folder',
    folderId,
  })

  const outlineSections = [
    { title: 'Section A', description: 'Desc A', knowledgeType: 'factual', order: 0 },
    { title: 'Section B', description: 'Desc B', knowledgeType: 'conceptual', order: 1 },
    { title: 'Section C', description: 'Desc C', knowledgeType: 'procedural', order: 2 },
  ]

  await asUser.mutation(api.courses.finalizeOutline, {
    courseId,
    outlineSections,
    sourceConfidence: { docCount: 1, webPercent: 0 },
    totalSectionCount: 3,
  })

  const sections = await asUser.query(api.courseSections.listByCourse, { courseId })

  return { asUser, courseId, folderId, sections }
}

describe('courseSections.listByCourse', () => {
  test('returns sections in order', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)
    expect(sections).toHaveLength(3)
    expect(sections[0].title).toBe('Section A')
    expect(sections[1].title).toBe('Section B')
    expect(sections[2].title).toBe('Section C')
    expect(sections[0].order).toBe(0)
  })

  test('returns empty array for other user', async () => {
    const t = convexTest(schema, modules)
    const { courseId } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)
    const sections = await asOther.query(api.courseSections.listByCourse, { courseId })
    expect(sections).toEqual([])
  })
})

describe('courseSections.updateTitle', () => {
  test('updates section and course outline title', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await asUser.mutation(api.courseSections.updateTitle, {
      sectionId: sections[0]._id,
      title: 'Renamed Section',
    })

    const updated = await asUser.query(api.courseSections.listByCourse, { courseId })
    expect(updated[0].title).toBe('Renamed Section')

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.outlineSections[0].title).toBe('Renamed Section')
  })

  test('rejects update from non-owner', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)
    await expect(
      asOther.mutation(api.courseSections.updateTitle, {
        sectionId: sections[0]._id,
        title: 'Hacked',
      }),
    ).rejects.toThrow()
  })
})

describe('courseSections.updateKnowledgeType', () => {
  test('updates section and course outline knowledgeType', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await asUser.mutation(api.courseSections.updateKnowledgeType, {
      sectionId: sections[0]._id,
      knowledgeType: 'mixed',
    })

    const updated = await asUser.query(api.courseSections.listByCourse, { courseId })
    expect(updated[0].knowledgeType).toBe('mixed')

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.outlineSections[0].knowledgeType).toBe('mixed')
  })
})

describe('courseSections.remove', () => {
  test('removes section, re-orders siblings, and updates course', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await asUser.mutation(api.courseSections.remove, { sectionId: sections[1]._id })

    const remaining = await asUser.query(api.courseSections.listByCourse, { courseId })
    expect(remaining).toHaveLength(2)
    expect(remaining[0].title).toBe('Section A')
    expect(remaining[0].order).toBe(0)
    expect(remaining[1].title).toBe('Section C')
    expect(remaining[1].order).toBe(1)

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.outlineSections).toHaveLength(2)
    expect(course!.totalSectionCount).toBe(2)
  })

  test('rejects removal from non-owner', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)
    await expect(
      asOther.mutation(api.courseSections.remove, { sectionId: sections[0]._id }),
    ).rejects.toThrow()
  })
})

describe('courseSections.create', () => {
  test('creates new section at end and updates course', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedCourseWithSections(t)

    const newId = await asUser.mutation(api.courseSections.create, { courseId })

    const all = await asUser.query(api.courseSections.listByCourse, { courseId })
    expect(all).toHaveLength(4)
    const newSection = all.find((s) => s._id === newId)
    expect(newSection).toBeDefined()
    expect(newSection!.title).toBe('New Section')
    expect(newSection!.knowledgeType).toBe('mixed')
    expect(newSection!.status).toBe('locked')
    expect(newSection!.order).toBe(3)

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.totalSectionCount).toBe(4)
    expect(course!.outlineSections).toHaveLength(4)
  })

  test('accepts custom title and knowledgeType', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedCourseWithSections(t)

    const newId = await asUser.mutation(api.courseSections.create, {
      courseId,
      title: 'Custom Section',
      knowledgeType: 'factual',
    })

    const section = await t.run(async (ctx) => ctx.db.get(newId))
    expect(section!.title).toBe('Custom Section')
    expect(section!.knowledgeType).toBe('factual')
  })

  test('rejects creation for non-owner course', async () => {
    const t = convexTest(schema, modules)
    const { courseId } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)
    await expect(
      asOther.mutation(api.courseSections.create, { courseId }),
    ).rejects.toThrow()
  })
})

describe('courseSections.updateOrder', () => {
  test('reorders sections and updates course outline', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await asUser.mutation(api.courseSections.updateOrder, {
      courseId,
      sectionIds: [sections[2]._id, sections[0]._id, sections[1]._id],
    })

    const reordered = await asUser.query(api.courseSections.listByCourse, { courseId })
    expect(reordered[0].title).toBe('Section C')
    expect(reordered[0].order).toBe(0)
    expect(reordered[1].title).toBe('Section A')
    expect(reordered[1].order).toBe(1)
    expect(reordered[2].title).toBe('Section B')
    expect(reordered[2].order).toBe(2)

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.outlineSections[0].title).toBe('Section C')
    expect(course!.outlineSections[1].title).toBe('Section A')
    expect(course!.outlineSections[2].title).toBe('Section B')
  })

  test('rejects reorder from non-owner', async () => {
    const t = convexTest(schema, modules)
    const { courseId, sections } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)
    await expect(
      asOther.mutation(api.courseSections.updateOrder, {
        courseId,
        sectionIds: [sections[2]._id, sections[0]._id, sections[1]._id],
      }),
    ).rejects.toThrow()
  })
})

describe('courses.updateOutline', () => {
  test('updates outline and totalSectionCount', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedCourseWithSections(t)

    const newOutline = [
      { title: 'Only Section', description: 'desc', knowledgeType: 'mixed', order: 0 },
    ]

    await asUser.mutation(api.courses.updateOutline, {
      courseId,
      outlineSections: newOutline,
      totalSectionCount: 1,
    })

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.outlineSections).toHaveLength(1)
    expect(course!.totalSectionCount).toBe(1)
  })
})

describe('courseSections.finalizeSectionGeneration', () => {
  test('creates quiz and flashcard entities and sets section to ready', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)
    const sectionId = sections[0]._id

    await asUser.mutation(api.courseSections.finalizeSectionGeneration, {
      sectionId,
      textContent: 'This is the section text explanation.',
      quizData: {
        title: 'Section A Quiz',
        questions: [
          {
            order: 0,
            question: 'What is a fact?',
            type: 'multiple-choice',
            options: ['A', 'B', 'C', 'D'],
            correctAnswer: 'A',
            explanation: 'A is correct',
          },
        ],
      },
      flashcardData: {
        title: 'Section A Flashcards',
        cards: [
          { term: 'Term 1', definition: 'Definition 1' },
          { term: 'Term 2', definition: 'Definition 2' },
        ],
      },
    })

    const section = await t.run(async (ctx) => ctx.db.get(sectionId))
    expect(section!.status).toBe('ready')
    expect(section!.contentBlocks).toHaveLength(3)

    const textBlock = section!.contentBlocks.find((b: any) => b.type === 'text')
    expect(textBlock).toBeDefined()
    expect(textBlock!.content).toBe('This is the section text explanation.')

    const quizBlock = section!.contentBlocks.find((b: any) => b.type === 'quiz')
    expect(quizBlock).toBeDefined()
    expect(quizBlock!.entityId).toBeTruthy()
    expect(quizBlock!.entityType).toBe('quiz')

    const fcBlock = section!.contentBlocks.find((b: any) => b.type === 'flashcard')
    expect(fcBlock).toBeDefined()
    expect(fcBlock!.entityId).toBeTruthy()
    expect(fcBlock!.entityType).toBe('flashcard')

    const quiz = await t.run(async (ctx) => ctx.db.get(quizBlock!.entityId as any)) as any
    expect(quiz).not.toBeNull()
    expect(quiz!.courseScoped).toBe(true)

    const room = await t.run(async (ctx) => ctx.db.get(fcBlock!.entityId as any)) as any
    expect(room).not.toBeNull()
    expect(room!.courseScoped).toBe(true)
  })

  test('content blocks are ordered: text -> quiz -> flashcard', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await asUser.mutation(api.courseSections.finalizeSectionGeneration, {
      sectionId: sections[0]._id,
      textContent: 'Explanation',
      quizData: {
        title: 'Quiz',
        questions: [{
          order: 0, question: 'Q?', type: 'true_false',
          options: ['True', 'False'], correctAnswer: 'True',
        }],
      },
      flashcardData: {
        title: 'Cards',
        cards: [{ term: 'T', definition: 'D' }],
      },
    })

    const section = await t.run(async (ctx) => ctx.db.get(sections[0]._id))
    const types = section!.contentBlocks.map((b: any) => b.type)
    expect(types).toEqual(['text', 'quiz', 'flashcard'])

    const orders = section!.contentBlocks.map((b: any) => b.order)
    expect(orders).toEqual([0, 1, 2])
  })

  test('handles partial failure gracefully', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await asUser.mutation(api.courseSections.finalizeSectionGeneration, {
      sectionId: sections[0]._id,
      textContent: 'Only text succeeded',
      failedEngines: ['quiz questions', 'flashcards'],
    })

    const section = await t.run(async (ctx) => ctx.db.get(sections[0]._id))
    expect(section!.status).toBe('ready')
    expect(section!.contentBlocks).toHaveLength(1)
    expect(section!.contentBlocks[0].type).toBe('text')
    expect(section!.failureNotice).toContain('quiz questions')
    expect(section!.failureNotice).toContain('flashcards')
  })

  test('marks section failed when all engines fail', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    const result = await asUser.mutation(api.courseSections.finalizeSectionGeneration, {
      sectionId: sections[0]._id,
      failedEngines: ['text', 'quiz', 'flashcards'],
    })

    expect(result.status).toBe('failed')

    const section = await t.run(async (ctx) => ctx.db.get(sections[0]._id))
    expect(section!.status).toBe('failed')
    expect(section!.failureNotice).toContain('All content engines failed')
  })

  test('entityType is stored alongside entityId', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await asUser.mutation(api.courseSections.finalizeSectionGeneration, {
      sectionId: sections[0]._id,
      quizData: {
        title: 'Quiz',
        questions: [{
          order: 0, question: 'Q?', type: 'true_false',
          options: ['True', 'False'], correctAnswer: 'True',
        }],
      },
    })

    const section = await t.run(async (ctx) => ctx.db.get(sections[0]._id))
    const quizBlock = section!.contentBlocks.find((b: any) => b.type === 'quiz')
    expect(quizBlock!.entityType).toBe('quiz')
    expect(quizBlock!.entityId).toBeTruthy()
  })

  test('rejects finalization from non-owner', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)

    await expect(
      asOther.mutation(api.courseSections.finalizeSectionGeneration, {
        sectionId: sections[0]._id,
        textContent: 'Hacked',
      }),
    ).rejects.toThrow()
  })
})

describe('courseSections.getNextSection', () => {
  test('returns the next section by order', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedCourseWithSections(t)

    const next = await asUser.query(api.courseSections.getNextSection, {
      courseId,
      currentOrder: 0,
    })

    expect(next).not.toBeNull()
    expect(next!.title).toBe('Section B')
    expect(next!.order).toBe(1)
  })

  test('returns null for the last section', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedCourseWithSections(t)

    const next = await asUser.query(api.courseSections.getNextSection, {
      courseId,
      currentOrder: 2,
    })

    expect(next).toBeNull()
  })

  test('returns null for non-owner', async () => {
    const t = convexTest(schema, modules)
    const { courseId } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)

    const next = await asOther.query(api.courseSections.getNextSection, {
      courseId,
      currentOrder: 0,
    })

    expect(next).toBeNull()
  })
})

describe('courseSections.checkPreFetchStatus', () => {
  test('returns needsPreFetch true for locked section', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedCourseWithSections(t)

    const result = await asUser.query(api.courseSections.checkPreFetchStatus, {
      courseId,
      currentOrder: 0,
    })

    expect(result).not.toBeNull()
    expect(result!.needsPreFetch).toBe(true)
    expect(result!.nextSection.status).toBe('locked')
  })

  test('returns needsPreFetch false for ready section', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[1]._id, { status: 'ready' })
    })

    const result = await asUser.query(api.courseSections.checkPreFetchStatus, {
      courseId,
      currentOrder: 0,
    })

    expect(result).not.toBeNull()
    expect(result!.needsPreFetch).toBe(false)
  })

  test('returns needsPreFetch false for generating section', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[1]._id, { status: 'generating' })
    })

    const result = await asUser.query(api.courseSections.checkPreFetchStatus, {
      courseId,
      currentOrder: 0,
    })

    expect(result).not.toBeNull()
    expect(result!.needsPreFetch).toBe(false)
  })

  test('returns needsPreFetch true for failed section', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[1]._id, { status: 'failed' })
    })

    const result = await asUser.query(api.courseSections.checkPreFetchStatus, {
      courseId,
      currentOrder: 0,
    })

    expect(result).not.toBeNull()
    expect(result!.needsPreFetch).toBe(true)
  })

  test('returns null when no next section exists', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedCourseWithSections(t)

    const result = await asUser.query(api.courseSections.checkPreFetchStatus, {
      courseId,
      currentOrder: 2,
    })

    expect(result).toBeNull()
  })

  test('returns projection without contentBlocks', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[1]._id, {
        status: 'ready',
        contentBlocks: [
          { type: 'text', content: 'Large block', order: 0 },
          { type: 'quiz', entityId: 'q1', entityType: 'quiz', order: 1 },
        ],
      })
    })

    const result = await asUser.query(api.courseSections.checkPreFetchStatus, {
      courseId,
      currentOrder: 0,
    })

    expect(result).not.toBeNull()
    expect(result!.nextSection).toEqual({
      _id: sections[1]._id,
      status: 'ready',
    })
    expect((result!.nextSection as any).contentBlocks).toBeUndefined()
    expect((result!.nextSection as any).title).toBeUndefined()
    expect((result!.nextSection as any).knowledgeType).toBeUndefined()
  })
})

describe('courseSections.triggerPreFetch', () => {
  test('transitions locked section to generating and creates task', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    const result = await asUser.mutation(api.courseSections.triggerPreFetch, {
      courseId,
      currentOrder: 0,
    })

    expect(result).not.toBeNull()
    expect(result!.sectionId).toBe(sections[1]._id)
    expect(result!.taskId).toBeTruthy()

    const section = await t.run(async (ctx) => ctx.db.get(sections[1]._id))
    expect(section!.status).toBe('generating')
    expect(section!.taskId).toBe(result!.taskId)
  })

  test('returns null when next section is already ready', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[1]._id, { status: 'ready' })
    })

    const result = await asUser.mutation(api.courseSections.triggerPreFetch, {
      courseId,
      currentOrder: 0,
    })

    expect(result).toBeNull()
  })

  test('returns null when next section is already generating', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[1]._id, { status: 'generating' })
    })

    const result = await asUser.mutation(api.courseSections.triggerPreFetch, {
      courseId,
      currentOrder: 0,
    })

    expect(result).toBeNull()
  })

  test('returns null when no next section exists', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedCourseWithSections(t)

    const result = await asUser.mutation(api.courseSections.triggerPreFetch, {
      courseId,
      currentOrder: 2,
    })

    expect(result).toBeNull()
  })

  test('retries a failed section once', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, folderId, sections } = await seedCourseWithSections(t)

    const failedTaskId = await t.run(async (ctx) => {
      return await ctx.db.insert('tasks', {
        userId: USER_A.tokenIdentifier,
        folderId,
        type: 'section-generate',
        status: 'failed',
        title: 'Failed generation',
        progress: 'Failed',
        metadata: { courseId, sectionId: sections[1]._id },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: Date.now(),
        error: 'Test failure',
      })
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[1]._id, { status: 'failed', taskId: failedTaskId })
    })

    const result = await asUser.mutation(api.courseSections.triggerPreFetch, {
      courseId,
      currentOrder: 0,
    })

    expect(result).not.toBeNull()
    expect(result!.sectionId).toBe(sections[1]._id)

    const section = await t.run(async (ctx) => ctx.db.get(sections[1]._id))
    expect(section!.status).toBe('generating')
  })

  test('does not retry a failed section more than once', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, folderId, sections } = await seedCourseWithSections(t)

    const retryTaskId = await t.run(async (ctx) => {
      return await ctx.db.insert('tasks', {
        userId: USER_A.tokenIdentifier,
        folderId,
        type: 'section-generate',
        status: 'failed',
        title: 'Retry failed',
        progress: 'Failed',
        metadata: { courseId, sectionId: sections[1]._id, retryOf: 'some-task-id' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: Date.now(),
        error: 'Retry also failed',
      })
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[1]._id, { status: 'failed', taskId: retryTaskId })
    })

    const result = await asUser.mutation(api.courseSections.triggerPreFetch, {
      courseId,
      currentOrder: 0,
    })

    expect(result).toBeNull()

    const section = await t.run(async (ctx) => ctx.db.get(sections[1]._id))
    expect(section!.status).toBe('failed')
  })

  test('rejects trigger from non-owner', async () => {
    const t = convexTest(schema, modules)
    const { courseId } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)

    await expect(
      asOther.mutation(api.courseSections.triggerPreFetch, {
        courseId,
        currentOrder: 0,
      }),
    ).rejects.toThrow()
  })
})

describe('courseSections.completeSection', () => {
  test('first completion always transitions to learning via state machine', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    const result = await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 85,
      quizCorrect: 5,
      quizTotal: 6,
    })

    expect(result.practiceScore).toBe(85)
    expect(result.masteryLevel).toBe('learning')
    expect(result.adaptiveHint).toBe('standard')
    expect(result.feedbackText).toBe('')
    expect(result.conceptsForReview).toBe(0)

    const section = await t.run(async (ctx) => ctx.db.get(sections[0]._id))
    expect(section!.status).toBe('completed')
    expect(section!.practiceScore).toBe(85)
    expect(section!.masteryLevel).toBe('learning')
    expect(section!.consecutiveReviewPasses).toBe(0)
    expect(section!.completedAt).toBeDefined()
  })

  test('increments course completedSectionCount', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    const courseBefore = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(courseBefore!.completedSectionCount).toBe(0)

    await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 75,
      quizCorrect: 3,
      quizTotal: 4,
    })

    const courseAfter = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(courseAfter!.completedSectionCount).toBe(1)
  })

  test('high score on first completion still yields learning (not mastered)', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    const result = await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 95,
      quizCorrect: 9,
      quizTotal: 10,
    })

    expect(result.masteryLevel).toBe('learning')
    expect(result.adaptiveHint).toBe('reduce-practice')
    expect(result.feedbackText).toContain('Excellent')
  })

  test('returns adaptive feedback for score < 60', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    const result = await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 40,
      quizCorrect: 2,
      quizTotal: 5,
    })

    expect(result.masteryLevel).toBe('learning')
    expect(result.adaptiveHint).toBe('increase-practice')
    expect(result.feedbackText).toContain('foundational practice')
  })

  test('clamps score to 0-100 range', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    const result = await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 150,
      quizCorrect: 10,
      quizTotal: 10,
    })

    expect(result.practiceScore).toBe(100)
    expect(result.masteryLevel).toBe('learning')
  })

  test('is idempotent for already-completed sections', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 80,
      quizCorrect: 4,
      quizTotal: 5,
    })

    const result = await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 50,
      quizCorrect: 1,
      quizTotal: 2,
    })

    expect(result.practiceScore).toBe(80)
    expect(result.masteryLevel).toBe('learning')

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.completedSectionCount).toBe(1)
  })

  test('rejects completion from non-owner', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)

    await expect(
      asOther.mutation(api.courseSections.completeSection, {
        sectionId: sections[0]._id,
        practiceScore: 80,
        quizCorrect: 4,
        quizTotal: 5,
      }),
    ).rejects.toThrow()
  })

  test('mastery level learning for any first-completion score', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    const result = await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 65,
      quizCorrect: 3,
      quizTotal: 5,
    })

    expect(result.masteryLevel).toBe('learning')
    expect(result.adaptiveHint).toBe('standard')
  })

  test('score of exactly 90 gets reduce-practice hint but learning mastery on first completion', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    const result = await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 90,
      quizCorrect: 9,
      quizTotal: 10,
    })

    expect(result.masteryLevel).toBe('learning')
    expect(result.adaptiveHint).toBe('reduce-practice')
  })

  test('rejects completion of non-ready section', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await expect(
      asUser.mutation(api.courseSections.completeSection, {
        sectionId: sections[0]._id,
        practiceScore: 80,
        quizCorrect: 4,
        quizTotal: 5,
      }),
    ).rejects.toThrow('Section is not ready for completion')
  })
})

describe('courseSections.reviewSection', () => {
  async function seedCompletedSection(t: ReturnType<typeof convexTest>) {
    const { asUser, courseId, folderId, sections } = await seedCourseWithSections(t)
    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })
    await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 75,
      quizCorrect: 3,
      quizTotal: 4,
    })
    return { asUser, courseId, folderId, sections, sectionId: sections[0]._id }
  }

  test('learning -> reviewing when reviewed at >= 70%', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sectionId } = await seedCompletedSection(t)

    const result = await asUser.mutation(api.courseSections.reviewSection, {
      sectionId,
      practiceScore: 75,
      quizCorrect: 3,
      quizTotal: 4,
    })

    expect(result.masteryLevel).toBe('reviewing')
    expect(result.previousMasteryLevel).toBe('learning')

    const section = await t.run(async (ctx) => ctx.db.get(sectionId))
    expect(section!.masteryLevel).toBe('reviewing')
    expect(section!.consecutiveReviewPasses).toBe(0)
    expect(section!.reviewHistory).toHaveLength(1)
    expect(section!.reviewHistory![0].score).toBe(75)
    expect(section!.reviewHistory![0].quizCorrect).toBe(3)
    expect(section!.reviewHistory![0].quizTotal).toBe(4)
  })

  test('learning stays learning when reviewed at < 70%', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sectionId } = await seedCompletedSection(t)

    const result = await asUser.mutation(api.courseSections.reviewSection, {
      sectionId,
      practiceScore: 50,
      quizCorrect: 2,
      quizTotal: 4,
    })

    expect(result.masteryLevel).toBe('learning')
  })

  test('reviewing -> mastered after 3 consecutive reviews at >= 80%', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sectionId } = await seedCompletedSection(t)

    await asUser.mutation(api.courseSections.reviewSection, {
      sectionId, practiceScore: 75, quizCorrect: 3, quizTotal: 4,
    })

    for (let i = 0; i < 3; i++) {
      await asUser.mutation(api.courseSections.reviewSection, {
        sectionId, practiceScore: 85, quizCorrect: 5, quizTotal: 6,
      })
    }

    const section = await t.run(async (ctx) => ctx.db.get(sectionId))
    expect(section!.masteryLevel).toBe('mastered')
    expect(section!.consecutiveReviewPasses).toBe(3)
  })

  test('reviewing does not advance to mastered if < 80% interrupts streak', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sectionId } = await seedCompletedSection(t)

    await asUser.mutation(api.courseSections.reviewSection, {
      sectionId, practiceScore: 75, quizCorrect: 3, quizTotal: 4,
    })

    await asUser.mutation(api.courseSections.reviewSection, {
      sectionId, practiceScore: 85, quizCorrect: 5, quizTotal: 6,
    })
    await asUser.mutation(api.courseSections.reviewSection, {
      sectionId, practiceScore: 85, quizCorrect: 5, quizTotal: 6,
    })

    await asUser.mutation(api.courseSections.reviewSection, {
      sectionId, practiceScore: 60, quizCorrect: 3, quizTotal: 5,
    })

    const section = await t.run(async (ctx) => ctx.db.get(sectionId))
    expect(section!.masteryLevel).toBe('learning')
    expect(section!.consecutiveReviewPasses).toBe(0)
  })

  test('mastered -> learning when section retaken (reviewed)', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sectionId } = await seedCompletedSection(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sectionId, {
        masteryLevel: 'mastered',
        consecutiveReviewPasses: 3,
      })
    })

    const result = await asUser.mutation(api.courseSections.reviewSection, {
      sectionId, practiceScore: 90, quizCorrect: 9, quizTotal: 10,
    })

    expect(result.masteryLevel).toBe('learning')
    expect(result.previousMasteryLevel).toBe('mastered')
  })

  test('reviewHistory is capped at 10 entries', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sectionId } = await seedCompletedSection(t)

    for (let i = 0; i < 12; i++) {
      await asUser.mutation(api.courseSections.reviewSection, {
        sectionId, practiceScore: 50 + i, quizCorrect: 2, quizTotal: 4,
      })
    }

    const section = await t.run(async (ctx) => ctx.db.get(sectionId))
    expect(section!.reviewHistory).toHaveLength(10)
    expect(section!.reviewHistory![0].score).toBe(52)
  })

  test('rejects review of non-completed section', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    await expect(
      asUser.mutation(api.courseSections.reviewSection, {
        sectionId: sections[0]._id,
        practiceScore: 80,
        quizCorrect: 4,
        quizTotal: 5,
      }),
    ).rejects.toThrow('Section must be completed before reviewing')
  })

  test('rejects review from non-owner', async () => {
    const t = convexTest(schema, modules)
    const { sectionId } = await seedCompletedSection(t)
    const asOther = t.withIdentity(USER_B)

    await expect(
      asOther.mutation(api.courseSections.reviewSection, {
        sectionId,
        practiceScore: 80,
        quizCorrect: 4,
        quizTotal: 5,
      }),
    ).rejects.toThrow()
  })

  test('does not change status from completed', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sectionId } = await seedCompletedSection(t)

    await asUser.mutation(api.courseSections.reviewSection, {
      sectionId, practiceScore: 90, quizCorrect: 9, quizTotal: 10,
    })

    const section = await t.run(async (ctx) => ctx.db.get(sectionId))
    expect(section!.status).toBe('completed')
  })
})

describe('mastery state machine (pure function)', () => {
  test('new -> learning on section_completed', () => {

    const result = transitionMastery(
      { level: 'new', consecutiveReviewPasses: 0 },
      { type: 'section_completed', score: 80 },
    )
    expect(result.level).toBe('learning')
    expect(result.consecutiveReviewPasses).toBe(0)
  })

  test('learning -> reviewing on section_reviewed >= 70%', () => {

    const result = transitionMastery(
      { level: 'learning', consecutiveReviewPasses: 0 },
      { type: 'section_reviewed', score: 70 },
    )
    expect(result.level).toBe('reviewing')
  })

  test('learning stays learning on section_reviewed < 70%', () => {

    const result = transitionMastery(
      { level: 'learning', consecutiveReviewPasses: 0 },
      { type: 'section_reviewed', score: 69 },
    )
    expect(result.level).toBe('learning')
  })

  test('reviewing -> mastered after 3 consecutive passes >= 80%', () => {

    let state: MasteryState = { level: 'reviewing', consecutiveReviewPasses: 0 }
    state = transitionMastery(state, { type: 'section_reviewed', score: 80 })
    expect(state.level).toBe('reviewing')
    expect(state.consecutiveReviewPasses).toBe(1)

    state = transitionMastery(state, { type: 'section_reviewed', score: 90 })
    expect(state.level).toBe('reviewing')
    expect(state.consecutiveReviewPasses).toBe(2)

    state = transitionMastery(state, { type: 'section_reviewed', score: 85 })
    expect(state.level).toBe('mastered')
    expect(state.consecutiveReviewPasses).toBe(3)
  })

  test('reviewing resets to learning on review < 80%', () => {

    const result = transitionMastery(
      { level: 'reviewing', consecutiveReviewPasses: 2 },
      { type: 'section_reviewed', score: 75 },
    )
    expect(result.level).toBe('learning')
    expect(result.consecutiveReviewPasses).toBe(0)
  })

  test('mastered -> reviewing on review_item_failed', () => {

    const result = transitionMastery(
      { level: 'mastered', consecutiveReviewPasses: 3 },
      { type: 'review_item_failed' },
    )
    expect(result.level).toBe('reviewing')
    expect(result.consecutiveReviewPasses).toBe(0)
  })

  test('mastered -> learning on section retake (section_reviewed)', () => {

    const result = transitionMastery(
      { level: 'mastered', consecutiveReviewPasses: 3 },
      { type: 'section_reviewed', score: 95 },
    )
    expect(result.level).toBe('learning')
    expect(result.consecutiveReviewPasses).toBe(0)
  })

  test('review_item_failed has no effect on non-mastered levels', () => {


    const r1 = transitionMastery(
      { level: 'new', consecutiveReviewPasses: 0 },
      { type: 'review_item_failed' },
    )
    expect(r1.level).toBe('new')

    const r2 = transitionMastery(
      { level: 'learning', consecutiveReviewPasses: 0 },
      { type: 'review_item_failed' },
    )
    expect(r2.level).toBe('learning')

    const r3 = transitionMastery(
      { level: 'reviewing', consecutiveReviewPasses: 1 },
      { type: 'review_item_failed' },
    )
    expect(r3.level).toBe('reviewing')
  })

  test('any -> learning on section_completed (even from mastered)', () => {


    const states = ['new', 'learning', 'reviewing', 'mastered'] as const
    for (const level of states) {
      const result = transitionMastery(
        { level, consecutiveReviewPasses: 2 },
        { type: 'section_completed', score: 50 },
      )
      expect(result.level).toBe('learning')
      expect(result.consecutiveReviewPasses).toBe(0)
    }
  })
})

describe('courseSections.setOfflineAvailable', () => {
  test('sets offlineAvailable to true', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await asUser.mutation(api.courseSections.setOfflineAvailable, {
      sectionId: sections[0]._id,
      offlineAvailable: true,
    })

    const section = await t.run(async (ctx) => ctx.db.get(sections[0]._id))
    expect(section!.offlineAvailable).toBe(true)
  })

  test('sets offlineAvailable to false', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    await asUser.mutation(api.courseSections.setOfflineAvailable, {
      sectionId: sections[0]._id,
      offlineAvailable: true,
    })
    await asUser.mutation(api.courseSections.setOfflineAvailable, {
      sectionId: sections[0]._id,
      offlineAvailable: false,
    })

    const section = await t.run(async (ctx) => ctx.db.get(sections[0]._id))
    expect(section!.offlineAvailable).toBe(false)
  })

  test('rejects from non-owner', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)

    await expect(
      asOther.mutation(api.courseSections.setOfflineAvailable, {
        sectionId: sections[0]._id,
        offlineAvailable: true,
      }),
    ).rejects.toThrow()
  })
})

describe('courseSections.getOfflineCachePayload', () => {
  test('returns null for non-completed section', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithSections(t)

    const payload = await asUser.query(api.courseSections.getOfflineCachePayload, {
      sectionId: sections[0]._id,
    })
    expect(payload).toBeNull()
  })

  test('returns payload for completed section with text block', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections, courseId } = await seedCourseWithSections(t)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, {
        status: 'completed',
        contentBlocks: [
          { type: 'text' as const, content: 'Test content', order: 0 },
        ],
      })
    })

    const payload = await asUser.query(api.courseSections.getOfflineCachePayload, {
      sectionId: sections[0]._id,
    })

    expect(payload).not.toBeNull()
    expect(payload!.sectionId).toBe(sections[0]._id)
    expect(payload!.courseId).toBe(courseId)
    expect(payload!.title).toBe('Section A')
    expect(payload!.contentBlocks).toHaveLength(1)
    expect(payload!.contentBlocks[0].type).toBe('text')
    expect(payload!.contentBlocks[0].content).toBe('Test content')
  })

  test('returns null for non-owner', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)
    const asOther = t.withIdentity(USER_B)

    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, {
        status: 'completed',
        contentBlocks: [{ type: 'text' as const, content: 'Test', order: 0 }],
      })
    })

    const payload = await asOther.query(api.courseSections.getOfflineCachePayload, {
      sectionId: sections[0]._id,
    })
    expect(payload).toBeNull()
  })
})

describe('courseSections internal mutations', () => {
  test('markReady sets status and contentBlocks', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)

    await t.mutation(internal.courseSections.markReady, {
      sectionId: sections[0]._id,
      contentBlocks: [
        { type: 'text', content: 'hello', order: 0 },
      ],
    })

    const section = await t.run(async (ctx) => ctx.db.get(sections[0]._id))
    expect(section!.status).toBe('ready')
    expect(section!.contentBlocks).toHaveLength(1)
  })

  test('markSectionFailed sets status to failed', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)

    await t.mutation(internal.courseSections.markSectionFailed, {
      sectionId: sections[0]._id,
      failureNotice: 'Test failure',
    })

    const section = await t.run(async (ctx) => ctx.db.get(sections[0]._id))
    expect(section!.status).toBe('failed')
    expect(section!.failureNotice).toBe('Test failure')
  })

  test('getForGeneration returns section with course and sourceDocs', async () => {
    const t = convexTest(schema, modules)
    const { sections } = await seedCourseWithSections(t)

    const result = await t.query(internal.courseSections.getForGeneration, {
      sectionId: sections[0]._id,
    })

    expect(result).not.toBeNull()
    expect(result!.section.title).toBe('Section A')
    expect(result!.course.title).toBe('Test Course')
    expect(result!.sourceDocs).toBeInstanceOf(Array)
  })
})
