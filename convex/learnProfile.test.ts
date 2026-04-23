/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { evaluateStreak, type StreakState } from './lib/streak'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_streak_a',
  name: 'Alice',
  email: 'alice@streak.test',
}

describe('evaluateStreak (pure logic)', () => {
  test('first activity ever starts streak at 1', () => {
    const state: StreakState = {
      streakCurrent: 0,
      streakLastDate: undefined,
      streakFreezeAvailable: true,
      streakFreezeUsedAt: undefined,
    }
    const result = evaluateStreak(state, '2026-04-23')
    expect(result.streakCurrent).toBe(1)
    expect(result.streakLastDate).toBe('2026-04-23')
    expect(result.frozeToday).toBe(false)
  })

  test('same-day activity does not increment', () => {
    const state: StreakState = {
      streakCurrent: 5,
      streakLastDate: '2026-04-23',
      streakFreezeAvailable: true,
      streakFreezeUsedAt: undefined,
    }
    const result = evaluateStreak(state, '2026-04-23')
    expect(result.streakCurrent).toBe(5)
    expect(result.streakLastDate).toBe('2026-04-23')
  })

  test('next-day activity increments streak', () => {
    const state: StreakState = {
      streakCurrent: 3,
      streakLastDate: '2026-04-22',
      streakFreezeAvailable: true,
      streakFreezeUsedAt: undefined,
    }
    const result = evaluateStreak(state, '2026-04-23')
    expect(result.streakCurrent).toBe(4)
    expect(result.streakLastDate).toBe('2026-04-23')
  })

  test('2-day gap with freeze available uses freeze', () => {
    const state: StreakState = {
      streakCurrent: 7,
      streakLastDate: '2026-04-21',
      streakFreezeAvailable: true,
      streakFreezeUsedAt: undefined,
    }
    const result = evaluateStreak(state, '2026-04-23')
    expect(result.streakCurrent).toBe(8)
    expect(result.streakLastDate).toBe('2026-04-23')
    expect(result.streakFreezeAvailable).toBe(false)
    expect(result.streakFreezeUsedAt).toBe('2026-04-23')
    expect(result.frozeToday).toBe(true)
  })

  test('2-day gap without freeze resets streak', () => {
    const state: StreakState = {
      streakCurrent: 10,
      streakLastDate: '2026-04-21',
      streakFreezeAvailable: false,
      streakFreezeUsedAt: '2026-04-20',
    }
    const result = evaluateStreak(state, '2026-04-23')
    expect(result.streakCurrent).toBe(1)
    expect(result.streakLastDate).toBe('2026-04-23')
    expect(result.frozeToday).toBe(false)
  })

  test('3-day gap resets streak even with freeze', () => {
    const state: StreakState = {
      streakCurrent: 5,
      streakLastDate: '2026-04-20',
      streakFreezeAvailable: true,
      streakFreezeUsedAt: undefined,
    }
    const result = evaluateStreak(state, '2026-04-23')
    expect(result.streakCurrent).toBe(1)
  })

  test('freeze resets on Monday (used last week)', () => {
    const state: StreakState = {
      streakCurrent: 3,
      streakLastDate: '2026-04-26',
      streakFreezeAvailable: false,
      streakFreezeUsedAt: '2026-04-24',
    }
    const result = evaluateStreak(state, '2026-04-27')
    expect(result.streakFreezeAvailable).toBe(true)
    expect(result.streakCurrent).toBe(4)
  })

  test('freeze does not reset if used this week', () => {
    const state: StreakState = {
      streakCurrent: 2,
      streakLastDate: '2026-04-22',
      streakFreezeAvailable: false,
      streakFreezeUsedAt: '2026-04-22',
    }
    const result = evaluateStreak(state, '2026-04-23')
    expect(result.streakFreezeAvailable).toBe(false)
  })

  test('streak break resets to 1 with no guilt', () => {
    const state: StreakState = {
      streakCurrent: 30,
      streakLastDate: '2026-04-10',
      streakFreezeAvailable: false,
      streakFreezeUsedAt: '2026-04-09',
    }
    const result = evaluateStreak(state, '2026-04-23')
    expect(result.streakCurrent).toBe(1)
  })
})

describe('streak integration with completeSection', () => {
  async function seedCourseWithReadySection(t: ReturnType<typeof convexTest>) {
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

    await asUser.mutation(api.courses.finalizeOutline, {
      courseId,
      outlineSections: [
        { title: 'Section A', description: 'Desc', knowledgeType: 'factual', order: 0 },
      ],
      sourceConfidence: { docCount: 1, webPercent: 0 },
      totalSectionCount: 1,
    })

    const sections = await asUser.query(api.courseSections.listByCourse, { courseId })
    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
    })

    return { asUser, courseId, folderId, sections }
  }

  test('completeSection updates streak on profile created during course creation', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithReadySection(t)

    const profileBefore = await asUser.query(api.learnProfile.getProfile)
    expect(profileBefore).not.toBeNull()
    expect(profileBefore!.streakCurrent).toBe(0)

    await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 80,
      quizCorrect: 4,
      quizTotal: 5,
    })

    const profileAfter = await asUser.query(api.learnProfile.getProfile)
    expect(profileAfter).not.toBeNull()
    expect(profileAfter!.streakCurrent).toBeGreaterThanOrEqual(1)
    expect(profileAfter!.streakLastDate).toBeTruthy()
  })

  test('completeSection updates streak for existing profile with yesterday activity', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithReadySection(t)

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query('learnProfile')
        .withIndex('by_userId', (q) => q.eq('userId', USER_A.tokenIdentifier))
        .unique()
      if (profile) {
        await ctx.db.patch(profile._id, {
          streakCurrent: 3,
          streakLastDate: yesterday,
          streakFreezeAvailable: true,
        })
      }
    })

    await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 80,
      quizCorrect: 4,
      quizTotal: 5,
    })

    const profile = await asUser.query(api.learnProfile.getProfile)
    expect(profile!.streakCurrent).toBe(4)
  })

  test('reviewSection also updates streak', async () => {
    const t = convexTest(schema, modules)
    const { asUser, sections } = await seedCourseWithReadySection(t)

    await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 80,
      quizCorrect: 4,
      quizTotal: 5,
    })

    const profileAfterComplete = await asUser.query(api.learnProfile.getProfile)
    const streakAfterComplete = profileAfterComplete!.streakCurrent

    await asUser.mutation(api.courseSections.reviewSection, {
      sectionId: sections[0]._id,
      practiceScore: 75,
      quizCorrect: 3,
      quizTotal: 4,
    })

    const profileAfterReview = await asUser.query(api.learnProfile.getProfile)
    expect(profileAfterReview!.streakCurrent).toBe(streakAfterComplete)
  })

  test('second completion same day does not double-increment streak', async () => {
    const t = convexTest(schema, modules)
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

    await asUser.mutation(api.courses.finalizeOutline, {
      courseId,
      outlineSections: [
        { title: 'Section A', description: 'Desc', knowledgeType: 'factual', order: 0 },
        { title: 'Section B', description: 'Desc', knowledgeType: 'factual', order: 1 },
      ],
      sourceConfidence: { docCount: 1, webPercent: 0 },
      totalSectionCount: 2,
    })

    const sections = await asUser.query(api.courseSections.listByCourse, { courseId })
    await t.run(async (ctx) => {
      await ctx.db.patch(sections[0]._id, { status: 'ready' })
      await ctx.db.patch(sections[1]._id, { status: 'ready' })
    })

    await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[0]._id,
      practiceScore: 80,
      quizCorrect: 4,
      quizTotal: 5,
    })

    const profileFirst = await asUser.query(api.learnProfile.getProfile)
    const streakFirst = profileFirst!.streakCurrent

    await asUser.mutation(api.courseSections.completeSection, {
      sectionId: sections[1]._id,
      practiceScore: 90,
      quizCorrect: 5,
      quizTotal: 5,
    })

    const profileSecond = await asUser.query(api.learnProfile.getProfile)
    expect(profileSecond!.streakCurrent).toBe(streakFirst)
  })
})

describe('getProfile query', () => {
  test('returns null for unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const result = await t.query(api.learnProfile.getProfile)
    expect(result).toBeNull()
  })

  test('returns null when no profile exists', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const result = await asUser.query(api.learnProfile.getProfile)
    expect(result).toBeNull()
  })

  test('returns profile with streak data', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert('learnProfile', {
        userId: USER_A.tokenIdentifier,
        streakCurrent: 5,
        streakLastDate: '2026-04-23',
        streakFreezeAvailable: true,
        dailyReviewCap: 50,
      })
    })

    const asUser = t.withIdentity(USER_A)
    const profile = await asUser.query(api.learnProfile.getProfile)
    expect(profile).not.toBeNull()
    expect(profile!.streakCurrent).toBe(5)
    expect(profile!.streakFreezeAvailable).toBe(true)
  })
})
