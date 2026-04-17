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
