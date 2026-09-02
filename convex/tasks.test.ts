/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
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

describe('tasks.create', () => {
  test('[P0] rejects unauthenticated', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    await expect(
      t.mutation(api.tasks.create, {
        folderId,
        type: 'flashcard-generation',
        title: 'Generating 12 cards…',
      }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects on foreign folder', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'Private' })

    await expect(
      asB.mutation(api.tasks.create, {
        folderId,
        type: 'flashcard-generation',
        title: 'Generating 12 cards…',
      }),
    ).rejects.toThrow(/Folder not found/)
  })

  test('[P0] creates task with pending status', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Generating 12 cards…',
      metadata: { roomId: 'room_1', cardCount: 12 },
    })

    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task).not.toBeNull()
    expect(task!.status).toBe('pending')
    expect(task!.type).toBe('flashcard-generation')
    expect(task!.userId).toBe(USER_A.tokenIdentifier)
    expect(task!.progress).toBe('Preparing…')
  })
})

describe('tasks.requestAudioOverview', () => {
  const preferences = { lengthMinutes: 10, complexity: 'beginner' } as const
  const voiceProfile = { hostA: 'asteria', hostB: 'orion' } as const

  async function setupUser(t: ReturnType<typeof convexTest>, identity = USER_A) {
    const asUser = t.withIdentity(identity)
    await asUser.mutation(api.users.upsertUser, {})
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const defaultDocumentId = await t.run(ctx => ctx.db.insert('documents', {
      userId: identity.tokenIdentifier,
      folderId,
      filename: 'ready.txt',
      status: 'success',
      fileSize: 5,
    }))
    return { asUser, folderId, defaultDocumentId }
  }

  test('[P0] reserves finite quota and freezes an exact owned source selection atomically', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await setupUser(t)
    const fileId = await t.run(ctx => ctx.storage.store(new Blob(['source'])))
    const documentId = await t.run(ctx => ctx.db.insert('documents', {
      userId: USER_A.tokenIdentifier,
      folderId,
      filename: 'cells.txt',
      fileId,
      r2Key: 'owned/cells.txt',
      status: 'success',
      fileSize: 6,
    }))

    const result = await asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'explicit', documentIds: [documentId] },
      preferences,
      voiceProfile,
    })

    expect(result.quota).toMatchObject({ used: 1, cap: 10 })
    const task = await t.run(ctx => ctx.db.get(result.taskId))
    expect(task?.status).toBe('pending')
    expect(task?.audioOverviewRequest?.scope.mode).toBe('explicit')
    expect(task?.audioOverviewRequest?.documents).toEqual([
      expect.objectContaining({ documentId, folderId, filename: 'cells.txt', r2Key: 'owned/cells.txt' }),
    ])
  })

  test('[P0] rejects an empty explicit selection without consuming quota or creating a task', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, defaultDocumentId } = await setupUser(t)

    await expect(asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'explicit', documentIds: [] },
      preferences,
      voiceProfile,
    })).rejects.toThrow(/at least one source/i)

    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(0)
    expect(await asUser.query(api.tasks.listByFolder, { folderId })).toEqual([])
  })

  test('[P0] rejects unbounded duration and caller-selected model overrides', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await setupUser(t)

    await expect(asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'folder' },
      preferences: { lengthMinutes: 1_000, complexity: 'expert' },
      voiceProfile,
    } as any)).rejects.toThrow()

    await expect(asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'folder' },
      preferences,
      voiceProfile,
      model: 'premium/unbounded-model',
    } as any)).rejects.toThrow()

    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(0)
  })

  test('[P0] rejects foreign and non-ready explicit sources before consuming quota', async () => {
    const t = convexTest(schema, modules)
    const { asUser: asA, folderId: folderA } = await setupUser(t, USER_A)
    const { folderId: folderB } = await setupUser(t, USER_B)
    const foreignDocumentId = await t.run(ctx => ctx.db.insert('documents', {
      userId: USER_B.tokenIdentifier,
      folderId: folderB,
      filename: 'private.txt',
      status: 'success',
      fileSize: 7,
    }))

    await expect(asA.mutation(api.tasks.requestAudioOverview, {
      folderId: folderA,
      scope: { mode: 'explicit', documentIds: [foreignDocumentId] },
      preferences,
      voiceProfile,
    })).rejects.toThrow(/source not found/i)

    expect((await asA.query(api.users.getDailyQuota, {}))?.used).toBe(0)
  })

  test('[P0] concurrent requests cannot oversubscribe the final daily allowance', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await setupUser(t)
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users')
        .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', USER_A.tokenIdentifier))
        .unique()
      await ctx.db.patch(user!._id, {
        audioOverviewQuota: { date: new Date().toISOString().slice(0, 10), count: 9 },
      })
    })

    const attempts = await Promise.allSettled([
      asUser.mutation(api.tasks.requestAudioOverview, {
        folderId,
        scope: { mode: 'folder' },
        preferences,
        voiceProfile,
      }),
      asUser.mutation(api.tasks.requestAudioOverview, {
        folderId,
        scope: { mode: 'folder' },
        preferences,
        voiceProfile,
      }),
    ])

    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(10)
    expect(await asUser.query(api.tasks.listByFolder, { folderId })).toHaveLength(1)
  })

  test('[P0] a reserved generation task can be claimed exactly once', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await setupUser(t)
    const { taskId } = await asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'folder' },
      preferences,
      voiceProfile,
    })

    const claimed = await asUser.mutation(api.tasks.claimAudioOverviewGeneration, { taskId })
    expect(claimed.folderId).toBe(folderId)
    expect(claimed.scope.mode).toBe('folder')
    await expect(
      asUser.mutation(api.tasks.claimAudioOverviewGeneration, { taskId }),
    ).rejects.toThrow(/not available/i)
  })

  test('[P1] freezes folder scope to the ready-document manifest at reservation time', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, defaultDocumentId } = await setupUser(t)
    const originalId = await t.run(ctx => ctx.db.insert('documents', {
      userId: USER_A.tokenIdentifier,
      folderId,
      filename: 'original.txt',
      status: 'success',
      fileSize: 8,
    }))
    const { taskId } = await asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'folder' },
      preferences,
      voiceProfile,
    })
    await t.run(ctx => ctx.db.insert('documents', {
      userId: USER_A.tokenIdentifier,
      folderId,
      filename: 'late.txt',
      status: 'success',
      fileSize: 4,
    }))

    const claimed = await asUser.mutation(api.tasks.claimAudioOverviewGeneration, { taskId })
    expect(claimed.documents.map(document => document.documentId)).toEqual([defaultDocumentId, originalId])
  })

  test('[P1] generic terminal and dismiss mutations cannot retire active audio work', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await setupUser(t)
    const { taskId } = await asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'folder' },
      preferences,
      voiceProfile,
    })

    await expect(asUser.mutation(api.tasks.markComplete, { taskId })).rejects.toThrow(/generation-owned/i)
    await expect(asUser.mutation(api.tasks.dismiss, { taskId })).rejects.toThrow(/active tasks/i)
    expect((await t.run(ctx => ctx.db.get(taskId)))?.status).toBe('pending')
  })

  test('[P1] provider failures use the audio-specific failed terminal state', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId } = await setupUser(t)
    const { taskId } = await asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'folder' },
      preferences,
      voiceProfile,
    })
    await asUser.mutation(api.tasks.claimAudioOverviewGeneration, { taskId })

    await asUser.mutation(api.tasks.failAudioOverviewGeneration, {
      taskId,
      error: 'Provider unavailable',
    })

    const task = await t.run(ctx => ctx.db.get(taskId))
    expect(task?.status).toBe('failed')
    expect(task?.error).toBe('Provider unavailable')
    expect(task?.completedAt).toBeTypeOf('number')
  })
})

describe('tasks.cancel', () => {
  test('[P0] rejects unauthenticated', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await expect(t.mutation(api.tasks.cancel, { taskId })).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects cross-user cancel', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asA.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await expect(asB.mutation(api.tasks.cancel, { taskId })).rejects.toThrow(/Task not found/)
  })

  test('[P0] sets status to cancelled', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await asUser.mutation(api.tasks.cancel, { taskId })

    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task!.status).toBe('cancelled')
    expect(task!.completedAt).toBeDefined()
  })

  test('[P1] no-op for already terminal tasks', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { status: 'completed', completedAt: Date.now() })
    })

    await asUser.mutation(api.tasks.cancel, { taskId })
    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task!.status).toBe('completed')
  })
})

describe('tasks.dismiss', () => {
  test('[P0] deletes the task row', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { status: 'completed', completedAt: Date.now() })
    })

    await asUser.mutation(api.tasks.dismiss, { taskId })

    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task).toBeNull()
  })

  test('[P0] rejects cross-user dismiss', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asA.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await expect(asB.mutation(api.tasks.dismiss, { taskId })).rejects.toThrow(/Task not found/)
  })
})

describe('tasks.retry', () => {
  test('[P0] creates new task from failed and deletes old', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
      metadata: { roomId: 'room_1', cardCount: 12 },
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { status: 'failed', error: 'boom', completedAt: Date.now() })
    })

    const { taskId: newTaskId } = await asUser.mutation(api.tasks.retry, { taskId })

    const oldTask = await t.run((ctx) => ctx.db.get(taskId))
    expect(oldTask).toBeNull()

    const newTask = await t.run((ctx) => ctx.db.get(newTaskId))
    expect(newTask).not.toBeNull()
    expect(newTask!.status).toBe('pending')
    expect((newTask!.metadata as any)?.roomId).toBe('room_1')
  })

  test('[P0] rejects retry on non-failed task', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await expect(asUser.mutation(api.tasks.retry, { taskId })).rejects.toThrow(/Only failed tasks/)
  })

  test('[P0] cannot retry an audio generation without a new quota reservation', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    await asUser.mutation(api.users.upsertUser, {})
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    await t.run(ctx => ctx.db.insert('documents', {
      userId: USER_A.tokenIdentifier,
      folderId,
      filename: 'ready.txt',
      status: 'success',
      fileSize: 5,
    }))
    const { taskId } = await asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'folder' },
      preferences: { lengthMinutes: 10, complexity: 'beginner' },
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
    })
    await asUser.mutation(api.tasks.cancel, { taskId })
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { status: 'failed', error: 'stop' })
    })

    await expect(asUser.mutation(api.tasks.retry, { taskId })).rejects.toThrow(/new quota reservation/i)
    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(1)
  })
})

describe('tasks.listByFolder', () => {
  test('[P0] returns only user tasks for the folder', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'FolderA' })
    const folderB = await asB.mutation(api.folders.createFolder, { name: 'FolderB' })

    await asA.mutation(api.tasks.create, {
      folderId: folderA,
      type: 'flashcard-generation',
      title: 'Task A1',
    })
    await asB.mutation(api.tasks.create, {
      folderId: folderB,
      type: 'flashcard-generation',
      title: 'Task B1',
    })

    const tasksA = await asA.query(api.tasks.listByFolder, { folderId: folderA })
    expect(tasksA.length).toBe(1)
    expect(tasksA[0]!.title).toBe('Task A1')

    const crossFolder = await asA.query(api.tasks.listByFolder, { folderId: folderB })
    expect(crossFolder.length).toBe(0)
  })

  test('[P0] returns empty for unauthenticated', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    const tasks = await t.query(api.tasks.listByFolder, { folderId })
    expect(tasks.length).toBe(0)
  })

  test('[P1] filters out old terminal tasks', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { taskId: oldTaskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Old completed',
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(oldTaskId, {
        status: 'completed',
        completedAt: Date.now() - 2 * 60 * 60 * 1000,
      })
    })

    await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Active',
    })

    const tasks = await asUser.query(api.tasks.listByFolder, { folderId })
    expect(tasks.length).toBe(1)
    expect(tasks[0]!.title).toBe('Active')
  })
})

describe('tasks.updateProgress (internal)', () => {
  test('[P0] updates progress and sets status to running', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await t.mutation(internal.tasks.updateProgress, {
      taskId,
      progress: 'Generating cards…',
    })

    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task!.progress).toBe('Generating cards…')
    expect(task!.status).toBe('running')
  })

  test('[P0] cannot revive a cancelled task', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'audio-overview-generation',
      title: 'Test',
    })

    await asUser.mutation(api.tasks.cancel, { taskId })
    await t.mutation(internal.tasks.updateProgress, { taskId, progress: 'Late progress' })

    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task!.status).toBe('cancelled')
    expect(task!.progress).toBe('Preparing…')
  })
})

describe('tasks.complete (internal)', () => {
  test('[P0] sets completed status and result', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await t.mutation(internal.tasks.complete, {
      taskId,
      result: { roomId: 'room_1', versionId: 'v_1', cardCount: 12 },
    })

    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task!.status).toBe('completed')
    expect(task!.progress).toBe('Complete')
    expect((task!.result as any)?.cardCount).toBe(12)
    expect(task!.completedAt).toBeDefined()
  })

  test('[P0] cannot complete a cancelled task', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'audio-overview-generation',
      title: 'Test',
    })

    await asUser.mutation(api.tasks.cancel, { taskId })
    await t.mutation(internal.tasks.complete, { taskId, result: { overviewId: 'late' } })

    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task!.status).toBe('cancelled')
    expect(task!.result).toBeUndefined()
  })
})

describe('tasks.fail (internal)', () => {
  test('[P0] sets failed status and error', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Test',
    })

    await t.mutation(internal.tasks.fail, {
      taskId,
      error: 'Not enough content',
    })

    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task!.status).toBe('failed')
    expect(task!.error).toBe('Not enough content')
    expect(task!.completedAt).toBeDefined()
  })

  test('[P0] cannot fail a cancelled task', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { taskId } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'audio-overview-generation',
      title: 'Test',
    })

    await asUser.mutation(api.tasks.cancel, { taskId })
    await t.mutation(internal.tasks.fail, { taskId, error: 'Late failure' })

    const task = await t.run((ctx) => ctx.db.get(taskId))
    expect(task!.status).toBe('cancelled')
    expect(task!.error).toBeUndefined()
  })
})

describe('tasks.cleanupTerminalTasks', () => {
  test('[P0] deletes old terminal tasks', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { taskId: oldTask } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Old',
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(oldTask, {
        status: 'completed',
        completedAt: Date.now() - 25 * 60 * 60 * 1000,
      })
    })

    const { taskId: recentTask } = await asUser.mutation(api.tasks.create, {
      folderId,
      type: 'flashcard-generation',
      title: 'Recent',
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(recentTask, {
        status: 'completed',
        completedAt: Date.now() - 1 * 60 * 60 * 1000,
      })
    })

    const result = await t.mutation(internal.tasks.cleanupTerminalTasks, {})
    expect(result.deleted).toBe(1)

    const old = await t.run((ctx) => ctx.db.get(oldTask))
    expect(old).toBeNull()

    const recent = await t.run((ctx) => ctx.db.get(recentTask))
    expect(recent).not.toBeNull()
  })
})
