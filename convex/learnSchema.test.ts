/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_learn_a',
  name: 'Alice',
  email: 'alice@example.com',
}

const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_learn_b',
  name: 'Bob',
  email: 'bob@example.com',
}

async function seedFolder(
  t: ReturnType<typeof convexTest>,
  identity: typeof USER_A,
) {
  const asUser = t.withIdentity(identity)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: `${identity.name} Folder` })
  return { asUser, folderId }
}

async function seedCourseData(
  t: ReturnType<typeof convexTest>,
  identity: typeof USER_A,
  folderId: ReturnType<typeof seedFolder> extends Promise<infer U> ? (U extends { folderId: infer F } ? F : never) : never,
) {
  const now = Date.now()
  const courseId = await t.run(async (ctx) => {
    return await ctx.db.insert('courses', {
      userId: identity.tokenIdentifier,
      folderId,
      title: `${identity.name} Course`,
      status: 'ready',
      sourceType: 'folder',
      sourceConfidence: { docCount: 3, webPercent: 0 },
      pace: 'steady',
      outlineSections: [
        { title: 'Section 1', description: 'Desc 1', knowledgeType: 'factual', order: 0 },
        { title: 'Section 2', description: 'Desc 2', knowledgeType: 'conceptual', order: 1 },
      ],
      completedSectionCount: 0,
      totalSectionCount: 2,
      webSearchEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
  })

  const sectionId = await t.run(async (ctx) => {
    return await ctx.db.insert('courseSections', {
      courseId,
      userId: identity.tokenIdentifier,
      order: 0,
      title: 'Section 1',
      knowledgeType: 'factual',
      status: 'locked',
      contentBlocks: [],
      masteryLevel: 'new',
    })
  })

  const sourceDocId = await t.run(async (ctx) => {
    return await ctx.db.insert('courseSourceDocs', {
      courseId,
      userId: identity.tokenIdentifier,
      folderId,
    })
  })

  return { courseId, sectionId, sourceDocId }
}

async function seedLearnProfile(
  t: ReturnType<typeof convexTest>,
  identity: typeof USER_A,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('learnProfile', {
      userId: identity.tokenIdentifier,
      streakCurrent: 5,
      streakLastDate: '2026-04-21',
      streakFreezeAvailable: true,
      dailyReviewCap: 50,
    })
  })
}

type TestClient = ReturnType<ReturnType<typeof convexTest>['withIdentity']>
type LearnExportCollection = 'courses' | 'courseSections' | 'learnProfile'
type ExportRow = Record<string, unknown>
type ExportPage = {
  page: ExportRow[]
  isDone: boolean
  continueCursor: string
}

async function readLearnExportPages(
  asUser: TestClient,
  collection: LearnExportCollection,
): Promise<ExportRow[]> {
  const rows: ExportRow[] = []
  let cursor: string | null = null

  while (true) {
    const result: ExportPage = await asUser.query(api.dataExport.getUserDataPage, {
      collection,
      paginationOpts: { cursor, numItems: 1 },
    })
    rows.push(...result.page)
    if (result.isDone) return rows
    cursor = result.continueCursor
  }
}

async function collectLearnDataForTest(asUser: TestClient) {
  const courses = await readLearnExportPages(asUser, 'courses')
  const courseSections = await readLearnExportPages(asUser, 'courseSections')
  const learnProfile = await readLearnExportPages(asUser, 'learnProfile')
  const courseSourceDocs: ExportRow[] = []

  for (const course of courses) {
    let cursor: string | null = null
    while (true) {
      const result: ExportPage | null = await asUser.query(api.dataExport.getCourseSourceDocsPage, {
        courseId: course._id as Id<'courses'>,
        paginationOpts: { cursor, numItems: 1 },
      })
      if (!result) break
      courseSourceDocs.push(...result.page)
      if (result.isDone) break
      cursor = result.continueCursor
    }
  }

  return { courses, courseSections, courseSourceDocs, learnProfile }
}

async function advanceAccountDeletionToExternalCleanup(
  t: ReturnType<typeof convexTest>,
  userId: string,
) {
  for (let batch = 0; batch < 100; batch++) {
    await t.mutation(internal.accountDeletion.runDeletionBatch, { userId })
    const phase = (await t.query(internal.accountDeletion.getDeletionTombstone, { userId }))?.phase
    if (phase === 'waitingExternal' || phase === 'complete') return
  }
  throw new Error('Account deletion did not finish its bounded database phases')
}

describe('courses table CRUD with ownership isolation', () => {
  test('user A can read their own course, user B cannot', async () => {
    const t = convexTest(schema, modules)
    const { folderId: folderA } = await seedFolder(t, USER_A)
    const { courseId } = await seedCourseData(t, USER_A, folderA)

    const courseA = await t.run(async (ctx) => {
      return await ctx.db.get(courseId)
    })
    expect(courseA).not.toBeNull()
    expect(courseA!.userId).toBe(USER_A.tokenIdentifier)
    expect(courseA!.title).toBe('Alice Course')

    const coursesForB = await t.run(async (ctx) => {
      return await ctx.db
        .query('courses')
        .withIndex('by_userId', (q) => q.eq('userId', USER_B.tokenIdentifier))
        .collect()
    })
    expect(coursesForB).toHaveLength(0)
  })

  test('courses index by_userId_and_folderId returns correct results', async () => {
    const t = convexTest(schema, modules)
    const { folderId: folderA } = await seedFolder(t, USER_A)
    const { folderId: folderB } = await seedFolder(t, USER_B)
    await seedCourseData(t, USER_A, folderA)
    await seedCourseData(t, USER_B, folderB)

    const coursesA = await t.run(async (ctx) => {
      return await ctx.db
        .query('courses')
        .withIndex('by_userId_and_folderId', (q) =>
          q.eq('userId', USER_A.tokenIdentifier).eq('folderId', folderA),
        )
        .collect()
    })
    expect(coursesA).toHaveLength(1)
    expect(coursesA[0]!.title).toBe('Alice Course')
  })
})

describe('courseSections ownership', () => {
  test('sections belong to the correct course and user', async () => {
    const t = convexTest(schema, modules)
    const { folderId } = await seedFolder(t, USER_A)
    const { courseId, sectionId } = await seedCourseData(t, USER_A, folderId)

    const section = await t.run(async (ctx) => {
      return await ctx.db.get(sectionId)
    })
    expect(section).not.toBeNull()
    expect(section!.courseId).toBe(courseId)
    expect(section!.userId).toBe(USER_A.tokenIdentifier)

    const sectionsForB = await t.run(async (ctx) => {
      return await ctx.db
        .query('courseSections')
        .withIndex('by_userId', (q) => q.eq('userId', USER_B.tokenIdentifier))
        .collect()
    })
    expect(sectionsForB).toHaveLength(0)
  })
})

describe('courseSourceDocs ownership', () => {
  test('source docs belong to the correct course', async () => {
    const t = convexTest(schema, modules)
    const { folderId } = await seedFolder(t, USER_A)
    const { courseId, sourceDocId } = await seedCourseData(t, USER_A, folderId)

    const doc = await t.run(async (ctx) => {
      return await ctx.db.get(sourceDocId)
    })
    expect(doc).not.toBeNull()
    expect(doc!.courseId).toBe(courseId)
    expect(doc!.userId).toBe(USER_A.tokenIdentifier)
  })
})

describe('learnProfile uniqueness per user', () => {
  test('each user has their own learnProfile', async () => {
    const t = convexTest(schema, modules)
    await seedLearnProfile(t, USER_A)
    await seedLearnProfile(t, USER_B)

    const profileA = await t.run(async (ctx) => {
      return await ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .unique()
    })
    expect(profileA).not.toBeNull()
    expect(profileA!.streakCurrent).toBe(5)

    const profileB = await t.run(async (ctx) => {
      return await ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_B.tokenIdentifier))
        .unique()
    })
    expect(profileB).not.toBeNull()
    expect(profileB!.userId).toBe(USER_B.tokenIdentifier)
  })
})

describe('courseScoped filter on folder queries', () => {
  test('quizzes.listByFolder excludes courseScoped quizzes', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)

    await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Normal Quiz',
      questions: [
        { order: 0, question: 'Q', type: 'free-response' as const, correctAnswer: 'A', sourceChunkContent: 'c', sourceFilename: 'f.pdf' },
      ],
    })

    await t.run(async (ctx) => {
      await ctx.db.insert('quizzes', {
        userId: USER_A.tokenIdentifier,
        folderId,
        title: 'Course Quiz',
        status: 'ready',
        courseScoped: true,
      })
    })

    const results = await asUser.query(api.quizzes.listByFolder, { folderId })
    expect(results).toHaveLength(1)
    expect(results[0]!.title).toBe('Normal Quiz')
  })

  test('flashcardRooms.listRoomsByFolder excludes courseScoped rooms', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)

    await asUser.mutation(api.flashcardRooms.createRoom, { folderId, title: 'Normal Room' })

    await t.run(async (ctx) => {
      await ctx.db.insert('flashcardRooms', {
        userId: USER_A.tokenIdentifier,
        folderId,
        title: 'Course Room',
        updatedAt: Date.now(),
        courseScoped: true,
      })
    })

    const results = await asUser.query(api.flashcardRooms.listRoomsByFolder, { folderId })
    expect(results).toHaveLength(1)
    expect(results[0]!.title).toBe('Normal Room')
  })

  test('audioOverviews.listByFolder excludes courseScoped overviews', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['audio-bytes'], { type: 'audio/wav' }))
    })

    await t.run(async (ctx) => {
      await ctx.db.insert('audioOverviews', {
        userId: USER_A.tokenIdentifier,
        folderId,
        title: 'Normal Overview',
        status: 'ready',
        turns: [{ speaker: 'host_a', text: 'Hello', audioFileId: storageId, durationMs: 1000 }],
        voiceProfile: { hostA: 'voice_a', hostB: 'voice_b' },
        totalDurationMs: 1000,
      })
    })

    await t.run(async (ctx) => {
      await ctx.db.insert('audioOverviews', {
        userId: USER_A.tokenIdentifier,
        folderId,
        title: 'Course Overview',
        status: 'ready',
        turns: [{ speaker: 'host_a', text: 'Hi', audioFileId: storageId, durationMs: 500 }],
        voiceProfile: { hostA: 'a', hostB: 'b' },
        totalDurationMs: 500,
        courseScoped: true,
      })
    })

    const results = await asUser.query(api.audioOverviews.listByFolder, { folderId })
    expect(results).toHaveLength(1)
    expect(results[0]!.title).toBe('Normal Overview')
  })
})

describe('account deletion cascade for Learn tables', () => {
  test('deleting user A removes their Learn data but not user B data', async () => {
    const t = convexTest(schema, modules)
    const { folderId: folderA } = await seedFolder(t, USER_A)
    const { folderId: folderB } = await seedFolder(t, USER_B)
    await seedCourseData(t, USER_A, folderA)
    await seedCourseData(t, USER_B, folderB)
    await seedLearnProfile(t, USER_A)
    await seedLearnProfile(t, USER_B)

    await t.mutation(internal.accountDeletion.deleteAccountCascade, {
      userId: USER_A.tokenIdentifier,
    })
    await advanceAccountDeletionToExternalCleanup(t, USER_A.tokenIdentifier)

    const coursesA = await t.run(async (ctx) => {
      return await ctx.db
        .query('courses')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .collect()
    })
    expect(coursesA).toHaveLength(0)

    const sectionsA = await t.run(async (ctx) => {
      return await ctx.db
        .query('courseSections')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .collect()
    })
    expect(sectionsA).toHaveLength(0)

    const profileA = await t.run(async (ctx) => {
      return await ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .collect()
    })
    expect(profileA).toHaveLength(0)

    const coursesB = await t.run(async (ctx) => {
      return await ctx.db
        .query('courses')
        .withIndex('by_userId', (q) => q.eq('userId', USER_B.tokenIdentifier))
        .collect()
    })
    expect(coursesB).toHaveLength(1)
    expect(coursesB[0]!.title).toBe('Bob Course')

    const sectionsB = await t.run(async (ctx) => {
      return await ctx.db
        .query('courseSections')
        .withIndex('by_userId', (q) => q.eq('userId', USER_B.tokenIdentifier))
        .collect()
    })
    expect(sectionsB).toHaveLength(1)

    const profileB = await t.run(async (ctx) => {
      return await ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_B.tokenIdentifier))
        .collect()
    })
    expect(profileB).toHaveLength(1)
  })
})

describe('dataExport includes Learn tables', () => {
  test('paginated export returns courses, courseSections, courseSourceDocs, learnProfile', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    await seedFolder(t, USER_B)
    await seedCourseData(t, USER_A, folderId)
    await seedLearnProfile(t, USER_A)

    const result = await collectLearnDataForTest(asUser)

    expect(result.courses).toHaveLength(1)
    expect(result.courses[0]!.title).toBe('Alice Course')
    expect(result.courseSections).toHaveLength(1)
    expect(result.courseSourceDocs).toHaveLength(1)
    expect(result.learnProfile).toHaveLength(1)
  })

  test('paginated export does not leak user B Learn data to user A', async () => {
    const t = convexTest(schema, modules)
    const { asUser: asUserA, folderId: folderA } = await seedFolder(t, USER_A)
    const { folderId: folderB } = await seedFolder(t, USER_B)
    await seedCourseData(t, USER_A, folderA)
    await seedCourseData(t, USER_B, folderB)

    const result = await collectLearnDataForTest(asUserA)

    expect(result.courses).toHaveLength(1)
    expect(result.courses[0]!.userId).toBe(USER_A.tokenIdentifier)
    expect(result.courseSections).toHaveLength(1)
    expect(result.courseSections[0]!.userId).toBe(USER_A.tokenIdentifier)
  })
})
