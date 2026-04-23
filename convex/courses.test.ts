/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

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
})

describe('courses.create — cross-folder source', () => {
  test('creates course with docs from different folders', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId: folder1 } = await seedFolder(t, USER_A, 'Folder 1')
    const { folderId: folder2 } = await seedFolder(t, USER_A, 'Folder 2')
    const docId1 = await seedDocument(t, USER_A, folder1, 'doc1.pdf')
    const docId2 = await seedDocument(t, USER_A, folder2, 'doc2.pdf')

    const result = await asUser.mutation(api.courses.create, {
      title: 'Cross Folder Course',
      sourceType: 'cross-folder',
      documentIds: [docId1, docId2],
    })

    const course = await t.run(async (ctx) => ctx.db.get(result.courseId))
    expect(course).not.toBeNull()
    expect(course!.sourceType).toBe('cross-folder')
    expect(course!.folderId).toBeUndefined()
    expect(course!.sourceConfidence).toEqual({ docCount: 2, webPercent: 0 })

    const sourceDocs = await t.run(async (ctx) =>
      ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .collect(),
    )
    expect(sourceDocs).toHaveLength(2)

    const doc1Source = sourceDocs.find((d) => d.documentId === docId1)
    const doc2Source = sourceDocs.find((d) => d.documentId === docId2)
    expect(doc1Source!.folderId).toBe(folder1)
    expect(doc2Source!.folderId).toBe(folder2)
  })
})

describe('courses.create — web-only source', () => {
  test('creates web-only course with no docs and no folder', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)

    const result = await asUser.mutation(api.courses.create, {
      title: 'React Hooks',
      sourceType: 'web-only',
    })

    expect(result.courseId).toBeDefined()
    expect(result.taskId).toBeDefined()

    const course = await t.run(async (ctx) => ctx.db.get(result.courseId))
    expect(course).not.toBeNull()
    expect(course!.status).toBe('generating')
    expect(course!.sourceType).toBe('web-only')
    expect(course!.folderId).toBeUndefined()
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

  test('creates web-only course with optional folderId', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await seedFolder(t, USER_A)

    const result = await asUser.mutation(api.courses.create, {
      title: 'Web Course in Folder',
      sourceType: 'web-only',
      folderId,
    })

    const course = await t.run(async (ctx) => ctx.db.get(result.courseId))
    expect(course).not.toBeNull()
    expect(course!.sourceType).toBe('web-only')
    expect(course!.folderId).toBe(folderId)
    expect(course!.webSearchEnabled).toBe(true)
    expect(course!.sourceConfidence).toEqual({ docCount: 0, webPercent: 100 })

    const sourceDocs = await t.run(async (ctx) =>
      ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', result.courseId))
        .collect(),
    )
    expect(sourceDocs).toHaveLength(0)
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
    await expect(
      t.mutation(api.courses.create, {
        title: 'Anon Course',
        sourceType: 'web-only',
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
        sourceType: 'cross-folder',
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
