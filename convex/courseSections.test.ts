/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

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
    const { asUser, courseId, sections } = await seedCourseWithSections(t)
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
