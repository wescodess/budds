/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { MAX_SOURCE_DOCS } from './courses'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_course_a',
  name: 'Alice',
  email: 'alice@example.com',
}

const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_course_b',
  name: 'Bob',
  email: 'bob@example.com',
}

async function seedFolder(
  t: ReturnType<typeof convexTest>,
  identity: typeof USER_A,
  name?: string,
) {
  const asUser = t.withIdentity(identity)
  const folderId = await asUser.mutation(api.folders.createFolder, {
    name: name ?? `${identity.name} Folder`,
  })
  return { asUser, folderId }
}

async function seedDocument(
  t: ReturnType<typeof convexTest>,
  identity: typeof USER_A,
  folderId: ReturnType<typeof seedFolder> extends Promise<infer U>
    ? U extends { folderId: infer F }
      ? F
      : never
    : never,
  filename?: string,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('documents', {
      userId: identity.tokenIdentifier,
      folderId,
      filename: filename ?? 'test-doc.pdf',
      status: 'success',
      fileSize: 1024,
    })
  })
}

describe('courses.create — folder source', () => {
  test('creates course, sourceDocs, task, and learnProfile', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    const docId1 = await seedDocument(t, USER_A, folderId, 'doc1.pdf')
    const docId2 = await seedDocument(t, USER_A, folderId, 'doc2.pdf')

    const result = await asUser.mutation(api.courses.create, {
      title: 'My Course',
      sourceType: 'folder',
      folderId,
    })

    expect(result.courseId).toBeDefined()
    expect(result.taskId).toBeDefined()

    const course = await t.run(async (ctx) => ctx.db.get(result.courseId))
    expect(course).not.toBeNull()
    expect(course!.status).toBe('generating')
    expect(course!.sourceType).toBe('folder')
    expect(course!.folderId).toBe(folderId)
    expect(course!.pace).toBe('steady')
    expect(course!.completedSectionCount).toBe(0)
    expect(course!.totalSectionCount).toBe(0)
    expect(course!.webSearchEnabled).toBe(false)
    expect(course!.outlineSections).toEqual([])
    expect(course!.sourceConfidence).toEqual({ docCount: 2, webPercent: 0 })
    expect(course!.taskId).toBe(result.taskId)

    const sourceDocs = await t.run(async (ctx) =>
      ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .collect(),
    )
    expect(sourceDocs).toHaveLength(2)
    const docIds = sourceDocs.map((d) => d.documentId).sort()
    expect(docIds).toContain(docId1)
    expect(docIds).toContain(docId2)

    const task = await t.run(async (ctx) => ctx.db.get(result.taskId))
    expect(task).not.toBeNull()
    expect(task!.type).toBe('course-outline')

    const profile = await t.run(async (ctx) =>
      ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .unique(),
    )
    expect(profile).not.toBeNull()
    expect(profile!.streakCurrent).toBe(0)
    expect(profile!.dailyReviewCap).toBe(50)
  })

  test('creates course with specific documentIds from folder', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    const docId1 = await seedDocument(t, USER_A, folderId, 'doc1.pdf')
    await seedDocument(t, USER_A, folderId, 'doc2.pdf')

    const result = await asUser.mutation(api.courses.create, {
      title: 'Selective Course',
      sourceType: 'folder',
      folderId,
      documentIds: [docId1],
    })

    const sourceDocs = await t.run(async (ctx) =>
      ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .collect(),
    )
    expect(sourceDocs).toHaveLength(1)
    expect(sourceDocs[0]!.documentId).toBe(docId1)
  })

  test('characterizes V1 accepting an owned document outside the selected folder', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId: selectedFolderId } = await seedFolder(
      t,
      USER_A,
      'Selected Folder',
    )
    const { folderId: unrelatedFolderId } = await seedFolder(
      t,
      USER_A,
      'Unrelated Folder',
    )
    const unrelatedDocumentId = await seedDocument(
      t,
      USER_A,
      unrelatedFolderId,
      'outside-selected-folder.pdf',
    )

    const result = await asUser.mutation(api.courses.create, {
      title: 'V1 Source Identity Characterization',
      sourceType: 'folder',
      folderId: selectedFolderId,
      documentIds: [unrelatedDocumentId],
    })

    const sourceDocs = await t.run(async (ctx) =>
      ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .take(2),
    )

    expect(sourceDocs).toHaveLength(1)
    expect(sourceDocs[0]).toMatchObject({
      documentId: unrelatedDocumentId,
      // Frozen V1 defect: this is the selected course folder, not the
      // document's real folder. V2 must not inherit this source identity.
      folderId: selectedFolderId,
    })
    expect(sourceDocs[0]!.folderId).not.toBe(unrelatedFolderId)
  })
})

describe('courses.create — source doc count cap', () => {
  test(`caps folder docs at MAX_SOURCE_DOCS (${MAX_SOURCE_DOCS}) when no documentIds specified`, async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)

    const totalDocs = MAX_SOURCE_DOCS + 20
    for (let i = 0; i < totalDocs; i++) {
      await seedDocument(t, USER_A, folderId, `doc-${i}.pdf`)
    }

    const result = await asUser.mutation(api.courses.create, {
      title: 'Large Folder Course',
      sourceType: 'folder',
      folderId,
    })

    const sourceDocs = await t.run(async (ctx) =>
      ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .collect(),
    )
    expect(sourceDocs).toHaveLength(MAX_SOURCE_DOCS)

    const course = await t.run(async (ctx) => ctx.db.get(result.courseId))
    expect(course!.sourceConfidence.docCount).toBe(MAX_SOURCE_DOCS)
  })

  test('does not cap when specific documentIds are provided', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)

    const docIds = []
    for (let i = 0; i < 5; i++) {
      docIds.push(await seedDocument(t, USER_A, folderId, `doc-${i}.pdf`))
    }

    const result = await asUser.mutation(api.courses.create, {
      title: 'Specific Docs Course',
      sourceType: 'folder',
      folderId,
      documentIds: docIds,
    })

    const sourceDocs = await t.run(async (ctx) =>
      ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .collect(),
    )
    expect(sourceDocs).toHaveLength(5)
  })
})

describe('courses.create — web-only source', () => {
  test('creates web-only course in folder with no docs', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)

    const result = await asUser.mutation(api.courses.create, {
      title: 'React Hooks',
      sourceType: 'web-only',
      folderId,
    })

    expect(result.courseId).toBeDefined()
    expect(result.taskId).toBeDefined()

    const course = await t.run(async (ctx) => ctx.db.get(result.courseId))
    expect(course).not.toBeNull()
    expect(course!.status).toBe('generating')
    expect(course!.sourceType).toBe('web-only')
    expect(course!.folderId).toBe(folderId)
    expect(course!.webSearchEnabled).toBe(true)
    expect(course!.sourceConfidence).toEqual({ docCount: 0, webPercent: 100 })
    expect(course!.taskId).toBe(result.taskId)

    const sourceDocs = await t.run(async (ctx) =>
      ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .collect(),
    )
    expect(sourceDocs).toHaveLength(0)

    const task = await t.run(async (ctx) => ctx.db.get(result.taskId))
    expect(task).not.toBeNull()
    expect(task!.type).toBe('course-outline')

    const profile = await t.run(async (ctx) =>
      ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .unique(),
    )
    expect(profile).not.toBeNull()
  })

  test('rejects web-only with foreign folder', async () => {
    const t = convexTest(schema, modules)
    const { folderId: folderB } = await seedFolder(t, USER_B)
    const asUserA = t.withIdentity(USER_A)

    await expect(
      asUserA.mutation(api.courses.create, {
        title: 'Steal Folder',
        sourceType: 'web-only',
        folderId: folderB,
      }),
    ).rejects.toThrow('Folder not found')
  })

  test('rejects unauthenticated web-only creation', async () => {
    const t = convexTest(schema, modules)
    const { folderId } = await seedFolder(t, USER_A)
    await expect(
      t.mutation(api.courses.create, {
        title: 'Anon Course',
        sourceType: 'web-only',
        folderId,
      }),
    ).rejects.toThrow('Unauthenticated')
  })
})

describe('courses.create — auth and ownership guards', () => {
  test('rejects unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const { folderId } = await seedFolder(t, USER_A)
    await expect(
      t.mutation(api.courses.create, {
        title: 'Test',
        sourceType: 'folder',
        folderId,
      }),
    ).rejects.toThrow('Unauthenticated')
  })

  test('rejects foreign folder', async () => {
    const t = convexTest(schema, modules)
    const { folderId: folderB } = await seedFolder(t, USER_B)
    const asUserA = t.withIdentity(USER_A)

    await expect(
      asUserA.mutation(api.courses.create, {
        title: 'Steal',
        sourceType: 'folder',
        folderId: folderB,
      }),
    ).rejects.toThrow('Folder not found')
  })

  test('rejects foreign document', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId: folderA } = await seedFolder(t, USER_A)
    const { folderId: folderB } = await seedFolder(t, USER_B)
    const docB = await seedDocument(t, USER_B, folderB, 'secret.pdf')

    await expect(
      asUser.mutation(api.courses.create, {
        title: 'Steal',
        sourceType: 'folder',
        folderId: folderA,
        documentIds: [docB],
      }),
    ).rejects.toThrow('Document not found')
  })
})

describe('courses.create — learnProfile upsert', () => {
  test('first course creates profile, second reuses it', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'doc.pdf')

    await asUser.mutation(api.courses.create, {
      title: 'First',
      sourceType: 'folder',
      folderId,
    })

    const profiles1 = await t.run(async (ctx) =>
      ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .collect(),
    )
    expect(profiles1).toHaveLength(1)

    await asUser.mutation(api.courses.create, {
      title: 'Second',
      sourceType: 'folder',
      folderId,
    })

    const profiles2 = await t.run(async (ctx) =>
      ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .collect(),
    )
    expect(profiles2).toHaveLength(1)
  })
})

describe('courses read queries', () => {
  test('listByUser returns only own courses ordered desc', async () => {
    const t = convexTest(schema, modules)
    const { asUser: asA, folderId: folderA } = await seedFolder(t, USER_A)
    const { folderId: folderB } = await seedFolder(t, USER_B)
    await seedDocument(t, USER_A, folderA, 'a.pdf')
    await seedDocument(t, USER_B, folderB, 'b.pdf')

    await asA.mutation(api.courses.create, {
      title: 'A Course 1',
      sourceType: 'folder',
      folderId: folderA,
    })
    await asA.mutation(api.courses.create, {
      title: 'A Course 2',
      sourceType: 'folder',
      folderId: folderA,
    })

    const asB = t.withIdentity(USER_B)
    await asB.mutation(api.courses.create, {
      title: 'B Course',
      sourceType: 'folder',
      folderId: folderB,
    })

    const listA = await asA.query(api.courses.listByUser, {})
    expect(listA).toHaveLength(2)
    expect(listA[0]!.title).toBe('A Course 2')
    expect(listA[1]!.title).toBe('A Course 1')

    const listB = await asB.query(api.courses.listByUser, {})
    expect(listB).toHaveLength(1)
    expect(listB[0]!.title).toBe('B Course')
  })

  test('listByFolder filters by folder', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId: folder1 } = await seedFolder(t, USER_A, 'F1')
    const { folderId: folder2 } = await seedFolder(t, USER_A, 'F2')
    await seedDocument(t, USER_A, folder1, 'a.pdf')
    await seedDocument(t, USER_A, folder2, 'b.pdf')

    await asUser.mutation(api.courses.create, {
      title: 'In F1',
      sourceType: 'folder',
      folderId: folder1,
    })
    await asUser.mutation(api.courses.create, {
      title: 'In F2',
      sourceType: 'folder',
      folderId: folder2,
    })

    const list = await asUser.query(api.courses.listByFolder, { folderId: folder1 })
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('In F1')
  })

  test('get returns course if owned, null if not', async () => {
    const t = convexTest(schema, modules)
    const { asUser: asA, folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'a.pdf')

    const { courseId } = await asA.mutation(api.courses.create, {
      title: 'A Course',
      sourceType: 'folder',
      folderId,
    })

    const got = await asA.query(api.courses.get, { id: courseId })
    expect(got).not.toBeNull()
    expect(got!.title).toBe('A Course')

    const asB = t.withIdentity(USER_B)
    const gotB = await asB.query(api.courses.get, { id: courseId })
    expect(gotB).toBeNull()
  })
})

describe('courseSourceDocs.listByCourse', () => {
  test('returns source docs for owned course', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    const docId = await seedDocument(t, USER_A, folderId, 'a.pdf')

    const { courseId } = await asUser.mutation(api.courses.create, {
      title: 'Test',
      sourceType: 'folder',
      folderId,
    })

    const docs = await asUser.query(api.courseSourceDocs.listByCourse, { courseId })
    expect(docs).toHaveLength(1)
    expect(docs[0]!.documentId).toBe(docId)
  })

  test('returns empty for foreign course', async () => {
    const t = convexTest(schema, modules)
    const { folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'a.pdf')

    const asA = t.withIdentity(USER_A)
    const { courseId } = await asA.mutation(api.courses.create, {
      title: 'Test',
      sourceType: 'folder',
      folderId,
    })

    const asB = t.withIdentity(USER_B)
    const docs = await asB.query(api.courseSourceDocs.listByCourse, { courseId })
    expect(docs).toEqual([])
  })
})

describe('courses.finalizeOutline', () => {
  const outlineSections = [
    { title: 'Intro', description: 'Overview', knowledgeType: 'conceptual', order: 0 },
    { title: 'Basics', description: 'Fundamentals', knowledgeType: 'factual', order: 1 },
    { title: 'Practice', description: 'Exercises', knowledgeType: 'procedural', order: 2 },
  ]

  test('updates course and creates section records', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'doc.pdf')

    const { courseId } = await asUser.mutation(api.courses.create, {
      title: 'Test Course',
      sourceType: 'folder',
      folderId,
    })

    await asUser.mutation(api.courses.finalizeOutline, {
      courseId,
      outlineSections,
      sourceConfidence: { docCount: 1, webPercent: 0 },
      totalSectionCount: 3,
    })

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.status).toBe('ready')
    expect(course!.outlineSections).toHaveLength(3)
    expect(course!.totalSectionCount).toBe(3)
    expect(course!.sourceConfidence).toEqual({ docCount: 1, webPercent: 0 })

    const sections = await t.run(async (ctx) =>
      ctx.db
        .query('courseSections')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .collect(),
    )
    expect(sections).toHaveLength(3)
    expect(sections[0]!.title).toBe('Intro')
    expect(sections[0]!.status).toBe('locked')
    expect(sections[0]!.masteryLevel).toBe('new')
    expect(sections[0]!.contentBlocks).toEqual([])
    expect(sections[0]!.knowledgeType).toBe('conceptual')
    expect(sections[1]!.knowledgeType).toBe('factual')
    expect(sections[2]!.knowledgeType).toBe('procedural')
  })

  test('rejects when course is not in generating state', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'doc.pdf')

    const { courseId } = await asUser.mutation(api.courses.create, {
      title: 'Test',
      sourceType: 'folder',
      folderId,
    })

    await asUser.mutation(api.courses.finalizeOutline, {
      courseId,
      outlineSections,
      sourceConfidence: { docCount: 1, webPercent: 0 },
      totalSectionCount: 3,
    })

    await expect(
      asUser.mutation(api.courses.finalizeOutline, {
        courseId,
        outlineSections,
        sourceConfidence: { docCount: 1, webPercent: 0 },
        totalSectionCount: 3,
      }),
    ).rejects.toThrow('Course is not in generating state')
  })

  test('rejects foreign user', async () => {
    const t = convexTest(schema, modules)
    const { asUser: asA, folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'doc.pdf')

    const { courseId } = await asA.mutation(api.courses.create, {
      title: 'Test',
      sourceType: 'folder',
      folderId,
    })

    const asB = t.withIdentity(USER_B)
    await expect(
      asB.mutation(api.courses.finalizeOutline, {
        courseId,
        outlineSections,
        sourceConfidence: { docCount: 1, webPercent: 0 },
        totalSectionCount: 3,
      }),
    ).rejects.toThrow('Course not found')
  })
})

describe('courses.markFailed', () => {
  test('sets course status to failed', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'doc.pdf')

    const { courseId } = await asUser.mutation(api.courses.create, {
      title: 'Failing Course',
      sourceType: 'folder',
      folderId,
    })

    await asUser.mutation(api.courses.markFailed, { courseId })

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.status).toBe('failed')
  })

  test('silently ignores foreign user', async () => {
    const t = convexTest(schema, modules)
    const { asUser: asA, folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'doc.pdf')

    const { courseId } = await asA.mutation(api.courses.create, {
      title: 'Test',
      sourceType: 'folder',
      folderId,
    })

    const asB = t.withIdentity(USER_B)
    await asB.mutation(api.courses.markFailed, { courseId })

    const course = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(course!.status).toBe('generating')
  })
})

async function seedReadyCourseWithSections(
  t: ReturnType<typeof convexTest>,
  identity: typeof USER_A,
) {
  const { asUser, folderId } = await seedFolder(t, identity)
  await seedDocument(t, identity, folderId, 'doc.pdf')

  const { courseId } = await asUser.mutation(api.courses.create, {
    title: 'Ready Course',
    sourceType: 'folder',
    folderId,
  })

  const outlineSections = [
    { title: 'Section A', description: 'First', knowledgeType: 'factual', order: 0 },
    { title: 'Section B', description: 'Second', knowledgeType: 'conceptual', order: 1 },
  ]

  await asUser.mutation(api.courses.finalizeOutline, {
    courseId,
    outlineSections,
    sourceConfidence: { docCount: 1, webPercent: 0 },
    totalSectionCount: 2,
  })

  return { asUser, folderId, courseId }
}

describe('courses.updatePace', () => {
  test('updates pace on owned course', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedReadyCourseWithSections(t, USER_A)

    const before = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(before!.pace).toBe('steady')

    await asUser.mutation(api.courses.updatePace, {
      courseId,
      pace: 'intensive',
    })

    const after = await t.run(async (ctx) => ctx.db.get(courseId))
    expect(after!.pace).toBe('intensive')
    expect(after!.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt)
  })

  test('rejects foreign user', async () => {
    const t = convexTest(schema, modules)
    const { courseId } = await seedReadyCourseWithSections(t, USER_A)

    const asB = t.withIdentity(USER_B)
    await expect(
      asB.mutation(api.courses.updatePace, { courseId, pace: 'relaxed' }),
    ).rejects.toThrow('Course not found')
  })

  test('rejects unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const { courseId } = await seedReadyCourseWithSections(t, USER_A)

    await expect(
      t.mutation(api.courses.updatePace, { courseId, pace: 'relaxed' }),
    ).rejects.toThrow('Unauthenticated')
  })
})

describe('courses.startCourse', () => {
  test('unlocks first section, creates task, returns courseId', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedReadyCourseWithSections(t, USER_A)

    const result = await asUser.mutation(api.courses.startCourse, { courseId })
    expect(result.courseId).toBe(courseId)
    expect(result.sectionId).toBeDefined()
    expect(result.taskId).toBeDefined()

    const sections = await t.run(async (ctx) =>
      ctx.db
        .query('courseSections')
        .withIndex('by_courseId_and_order', (q) =>
          q.eq('courseId', courseId).eq('order', 0),
        )
        .take(1),
    )
    expect(sections).toHaveLength(1)
    expect(sections[0]!.status).toBe('generating')
    expect(sections[0]!.taskId).toBeDefined()

    const task = await t.run(async (ctx) => ctx.db.get(sections[0]!.taskId!))
    expect(task).not.toBeNull()
    expect(task!.type).toBe('section-generate')
    expect(task!.metadata).toMatchObject({ courseId, sectionId: sections[0]!._id })
  })

  test('rejects course not in ready status', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'doc.pdf')

    const { courseId } = await asUser.mutation(api.courses.create, {
      title: 'Generating Course',
      sourceType: 'folder',
      folderId,
    })

    await expect(
      asUser.mutation(api.courses.startCourse, { courseId }),
    ).rejects.toThrow('Course is not ready to start')
  })

  test('rejects course with no sections', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    await seedDocument(t, USER_A, folderId, 'doc.pdf')

    const { courseId } = await asUser.mutation(api.courses.create, {
      title: 'Empty Course',
      sourceType: 'folder',
      folderId,
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(courseId, { status: 'ready' })
    })

    await expect(
      asUser.mutation(api.courses.startCourse, { courseId }),
    ).rejects.toThrow('Course has no sections')
  })

  test('rejects double start', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId } = await seedReadyCourseWithSections(t, USER_A)

    await asUser.mutation(api.courses.startCourse, { courseId })

    await expect(
      asUser.mutation(api.courses.startCourse, { courseId }),
    ).rejects.toThrow('Course has already been started')
  })

  test('rejects foreign user', async () => {
    const t = convexTest(schema, modules)
    const { courseId } = await seedReadyCourseWithSections(t, USER_A)

    const asB = t.withIdentity(USER_B)
    await expect(
      asB.mutation(api.courses.startCourse, { courseId }),
    ).rejects.toThrow('Course not found')
  })
})

describe('courses.deleteCourse — AC3: cascade deletion', () => {
  test('[P1] deletes more than one provider batch of historical calendar events', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    const result = await asUser.mutation(api.courses.create, {
      title: 'Long-running course',
      sourceType: 'web-only',
      folderId,
    })
    const connectionId = await asUser.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3_600_000,
      timezone: 'UTC',
    })
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index++) {
        await ctx.db.insert('calendarEvents', {
          userId: USER_A.tokenIdentifier,
          calendarConnectionId: connectionId,
          calendarEventId: `google-history-${index}`,
          courseId: result.courseId,
          scheduledAt: Date.now() - index * 86_400_000,
          sessionType: 'review',
          status: 'missed',
        })
      }
    })

    const previousEncryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    const deleteGoogleEvent = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', deleteGoogleEvent)
    try {
      await asUser.action(api.courses.deleteCourse, { id: result.courseId })
    }
    finally {
      if (previousEncryptionKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
      else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previousEncryptionKey
      vi.unstubAllGlobals()
    }

    expect(deleteGoogleEvent).toHaveBeenCalledTimes(101)
    expect(await t.run(ctx => ctx.db.get(result.courseId))).toBeNull()
  })

  test('[P1] resumes a large bounded local cascade after the initiating action yields', async () => {
    vi.useFakeTimers()
    try {
      const t = convexTest(schema, modules)
      const { asUser, folderId } = await seedFolder(t, USER_A)
      const result = await asUser.mutation(api.courses.create, {
        title: 'Large local cascade',
        sourceType: 'web-only',
        folderId,
      })
      await t.run(async (ctx) => {
        for (let index = 0; index < 70; index++) {
          await ctx.db.insert('courseSections', {
            courseId: result.courseId,
            userId: USER_A.tokenIdentifier,
            order: index,
            title: `Section ${index}`,
            knowledgeType: 'factual',
            status: 'locked',
            contentBlocks: [],
            masteryLevel: 'new',
          })
        }
      })

      const started = await asUser.action(api.courses.deleteCourse, { id: result.courseId })
      expect(started).toEqual({ deleted: false, pending: true })
      expect(await t.run(ctx => ctx.db.get(result.courseId))).toMatchObject({ status: 'deleting' })

      await t.finishAllScheduledFunctions(vi.runAllTimers)

      expect(await t.run(ctx => ctx.db.get(result.courseId))).toBeNull()
      const remainingSections = await t.run(ctx => ctx.db
        .query('courseSections')
        .withIndex('by_courseId', q => q.eq('courseId', result.courseId))
        .take(1))
      expect(remainingSections).toEqual([])
    }
    finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test('[P1] retries a durable provider failure and preserves provider-first ordering', async () => {
    vi.useFakeTimers()
    const previousEncryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    try {
      const t = convexTest(schema, modules)
      const { asUser, folderId } = await seedFolder(t, USER_A)
      const result = await asUser.mutation(api.courses.create, {
        title: 'Provider retry',
        sourceType: 'web-only',
        folderId,
      })
      const connectionId = await asUser.mutation(api.calendarConnections.upsertConnection, {
        provider: 'google',
        accessToken: 'dG9rZW4=',
        refreshToken: 'cmVmcmVzaA==',
        expiresAt: Date.now() + 3_600_000,
        timezone: 'UTC',
      })
      const eventId = await t.run(ctx => ctx.db.insert('calendarEvents', {
        userId: USER_A.tokenIdentifier,
        calendarConnectionId: connectionId,
        calendarEventId: 'google-durable-retry',
        courseId: result.courseId,
        scheduledAt: Date.now() + 86_400_000,
        sessionType: 'review',
        status: 'scheduled',
      }))
      const deleteGoogleEvent = vi.fn()
        .mockResolvedValueOnce(new Response('provider unavailable', { status: 503 }))
        .mockResolvedValue(new Response(null, { status: 204 }))
      vi.stubGlobal('fetch', deleteGoogleEvent)

      await expect(asUser.action(api.courses.deleteCourse, { id: result.courseId }))
        .rejects.toThrow('Google Calendar cleanup failed with status 503')
      expect(await t.run(ctx => ctx.db.get(eventId))).not.toBeNull()
      expect(await t.run(ctx => ctx.db.get(result.courseId))).toMatchObject({ status: 'deleting' })
      await asUser.mutation(api.courses.markFailed, { courseId: result.courseId })
      expect(await t.run(ctx => ctx.db.get(result.courseId))).toMatchObject({ status: 'deleting' })
      expect(await t.run(ctx => ctx.db
        .query('courseDeletionJobs')
        .withIndex('by_courseId', q => q.eq('courseId', result.courseId))
        .unique())).toMatchObject({ phase: 'providerEvents', attempts: 1 })

      await t.finishAllScheduledFunctions(vi.runAllTimers)

      expect(deleteGoogleEvent).toHaveBeenCalledTimes(2)
      expect(await t.run(ctx => ctx.db.get(eventId))).toBeNull()
      expect(await t.run(ctx => ctx.db.get(result.courseId))).toBeNull()
    }
    finally {
      if (previousEncryptionKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
      else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previousEncryptionKey
      vi.unstubAllGlobals()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test('[P1] recovery cron reclaims an interrupted expired course-deletion lease', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    const { courseId } = await asUser.mutation(api.courses.create, {
      title: 'Stale deletion',
      sourceType: 'web-only',
      folderId,
    })
    const jobId = await t.mutation(internal.courseDeletion.start, {
      courseId,
      userId: USER_A.tokenIdentifier,
    })
    await t.run(ctx => ctx.db.patch(jobId, {
      phase: 'providerEvents',
      leaseToken: 'abandoned-worker',
      leaseExpiresAt: Date.now() - 1,
      nextAttemptAt: 0,
      updatedAt: Date.now() - 16 * 60_000,
    }))

    expect(await t.mutation(internal.courseDeletion.resumeStale, {})).toEqual({ resumed: 1 })
    const resumed = await t.run(ctx => ctx.db.get(jobId))
    expect(resumed?.leaseToken).toBeUndefined()
    expect(resumed?.leaseExpiresAt).toBeUndefined()
  })

  test('deletes course, sections, and sourceDocss', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    const docId = await seedDocument(t, USER_A, folderId, 'doc.pdf')

    const result = await asUser.mutation(api.courses.create, {
      title: 'To Delete',
      sourceType: 'folder',
      folderId,
      documentIds: [docId],
    })

    await t.run(async (ctx) => {
      await ctx.db.insert('courseSections', {
        courseId: result.courseId,
        userId: USER_A.tokenIdentifier,
        order: 0,
        title: 'Section 1',
        knowledgeType: 'factual',
        status: 'locked',
        contentBlocks: [],
        masteryLevel: 'new',
      })
    })

    const connectionId = await asUser.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3_600_000,
      timezone: 'UTC',
    })
    await t.run(async (ctx) => {
      await ctx.db.insert('calendarEvents', {
        userId: USER_A.tokenIdentifier,
        calendarConnectionId: connectionId,
        calendarEventId: 'google-course-delete',
        courseId: result.courseId,
        scheduledAt: Date.now() + 86_400_000,
        sessionType: 'new-content',
        status: 'scheduled',
      })
    })

    const previousEncryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    const deleteGoogleEvent = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', deleteGoogleEvent)
    try {
      await asUser.action(api.courses.deleteCourse, { id: result.courseId })
    }
    finally {
      if (previousEncryptionKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
      else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previousEncryptionKey
      vi.unstubAllGlobals()
    }
    expect(deleteGoogleEvent).toHaveBeenCalledWith(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/google-course-delete',
      expect.objectContaining({ method: 'DELETE' }),
    )

    const course = await t.run(async (ctx) => ctx.db.get(result.courseId))
    expect(course).toBeNull()

    const sections = await t.run(async (ctx) =>
      ctx.db
        .query('courseSections')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .collect(),
    )
    expect(sections).toHaveLength(0)

    const sourceDocs = await t.run(async (ctx) =>
      ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .collect(),
    )
    expect(sourceDocs).toHaveLength(0)

    const calendarEvents = await t.run(async (ctx) =>
      ctx.db.query('calendarEvents').withIndex('by_courseId', q => q.eq('courseId', result.courseId)).collect(),
    )
    expect(calendarEvents).toHaveLength(0)
  })

  test('preserves the course and local event when Google Calendar deletion fails', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    const result = await asUser.mutation(api.courses.create, {
      title: 'Retry Calendar Cleanup',
      sourceType: 'web-only',
      folderId,
    })
    const connectionId = await asUser.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3_600_000,
      timezone: 'UTC',
    })
    const eventId = await t.run(ctx => ctx.db.insert('calendarEvents', {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'google-course-delete-retry',
      courseId: result.courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
      status: 'scheduled',
    }))

    const previousEncryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('provider unavailable', { status: 503 })))
    try {
      await expect(
        asUser.action(api.courses.deleteCourse, { id: result.courseId }),
      ).rejects.toThrow('Google Calendar cleanup failed with status 503')
    }
    finally {
      if (previousEncryptionKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
      else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previousEncryptionKey
      vi.unstubAllGlobals()
    }

    expect(await t.run(ctx => ctx.db.get(result.courseId))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(eventId))).not.toBeNull()
  })

  test('deletes course-scoped quizzes but not non-course-scoped', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)

    const result = await asUser.mutation(api.courses.create, {
      title: 'Course With Quizzes',
      sourceType: 'web-only',
      folderId,
    })

    const { courseScopedQuizId, normalQuizId, assessmentId, answerId, attemptId } = await t.run(async (ctx) => {
      const csQuizId = await ctx.db.insert('quizzes', {
        userId: USER_A.tokenIdentifier,
        folderId,
        title: 'Course Quiz',
        status: 'ready',
        courseScoped: true,
      })

      await ctx.db.insert('courseSections', {
        courseId: result.courseId,
        userId: USER_A.tokenIdentifier,
        order: 0,
        title: 'Section 1',
        knowledgeType: 'factual',
        status: 'ready',
        contentBlocks: [{ type: 'quiz', entityId: csQuizId, order: 0 }],
        masteryLevel: 'new',
      })

      const questionId = await ctx.db.insert('quizQuestions', {
        quizId: csQuizId,
        userId: USER_A.tokenIdentifier,
        order: 0,
        question: 'Explain the course concept.',
        type: 'free-response',
        correctAnswer: 'A grounded answer.',
        sourceChunkContent: 'Course evidence.',
      })
      const quizAttemptId = await ctx.db.insert('quizAttempts', {
        userId: USER_A.tokenIdentifier,
        quizId: csQuizId,
        score: 0,
        total: 1,
        status: 'completed',
        completedAt: Date.now(),
      })
      const attemptAnswerId = await ctx.db.insert('attemptAnswers', {
        attemptId: quizAttemptId,
        questionId,
        userAnswer: 'A learner answer.',
        isCorrect: false,
        answeredAt: Date.now(),
      })
      const quizAssessmentId = await ctx.db.insert('quizAnswerAssessments', {
        userId: USER_A.tokenIdentifier,
        attemptId: quizAttemptId,
        attemptAnswerId,
        questionId,
        kind: 'quiz.free_response_assessment.v1',
        status: 'pending',
        questionSnapshot: { question: 'Explain the course concept.', questionType: 'free-response', expectedAnswer: 'A grounded answer.', evidenceExcerpt: 'Course evidence.' },
        learnerAnswerSnapshot: 'A learner answer.',
        deterministicIsCorrect: false,
        rubricVersion: 'quiz.free_response_assessment.v1',
        rubricSnapshot: [],
        requestedAt: Date.now(),
      })

      const nQuizId = await ctx.db.insert('quizzes', {
        userId: USER_A.tokenIdentifier,
        folderId,
        title: 'Normal Quiz',
        status: 'ready',
      })

      return { courseScopedQuizId: csQuizId, normalQuizId: nQuizId, assessmentId: quizAssessmentId, answerId: attemptAnswerId, attemptId: quizAttemptId }
    })

    await asUser.action(api.courses.deleteCourse, { id: result.courseId })

    const csQuiz = await t.run(async (ctx) => ctx.db.get(courseScopedQuizId))
    expect(csQuiz).toBeNull()
    expect(await t.run(ctx => ctx.db.get(assessmentId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(answerId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(attemptId))).toBeNull()

    const normalQuiz = await t.run(async (ctx) => ctx.db.get(normalQuizId))
    expect(normalQuiz).not.toBeNull()
  })

  test('[P0] never follows a corrupted section reference across owner boundaries', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)
    const { folderId: otherFolderId } = await seedFolder(t, USER_B)
    const { courseId } = await asUser.mutation(api.courses.create, {
      title: 'Owned course',
      sourceType: 'web-only',
      folderId,
    })
    const foreignQuizId = await t.run(ctx => ctx.db.insert('quizzes', {
      userId: USER_B.tokenIdentifier,
      folderId: otherFolderId,
      title: 'Foreign course-scoped quiz',
      status: 'ready',
      courseScoped: true,
    }))
    await t.run(ctx => ctx.db.insert('courseSections', {
      courseId,
      userId: USER_A.tokenIdentifier,
      order: 0,
      title: 'Corrupted reference',
      knowledgeType: 'factual',
      status: 'ready',
      contentBlocks: [{ type: 'quiz', entityId: foreignQuizId, order: 0 }],
      masteryLevel: 'new',
    }))

    await asUser.action(api.courses.deleteCourse, { id: courseId })

    expect(await t.run(ctx => ctx.db.get(courseId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(foreignQuizId))).not.toBeNull()
  })

  test('rejects deletion by another user', async () => {
    const t = convexTest(schema, modules)
    const { asUser: _asA, folderId } = await seedFolder(t, USER_A)

    const result = await t.withIdentity(USER_A).mutation(api.courses.create, {
      title: 'Owned by A',
      sourceType: 'web-only',
      folderId,
    })

    const asB = t.withIdentity(USER_B)
    await expect(
      asB.action(api.courses.deleteCourse, { id: result.courseId }),
    ).rejects.toThrow('Course not found')
  })
})
