/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const USER = {
  tokenIdentifier: 'https://auth.example.com|audio_room_owner',
  name: 'Room Owner',
  email: 'rooms@example.com',
}

describe('Audio Overview room ownership', () => {
  test('[P0] keeps histories isolated between rooms in the same folder', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Biology' })
    const roomA = (await asUser.mutation(api.audioOverviewRooms.create, { folderId, title: 'Cells' })).roomId
    const roomB = (await asUser.mutation(api.audioOverviewRooms.create, { folderId, title: 'Genetics' })).roomId

    await t.run(async (ctx) => {
      for (const [roomId, title] of [[roomA, 'Cell episode'], [roomB, 'Genetics episode']] as const) {
        await ctx.db.insert('audioOverviews', {
          userId: USER.tokenIdentifier,
          folderId,
          roomId,
          title,
          status: 'ready',
          turns: [],
          voiceProfile: { hostA: 'Kore', hostB: 'Puck' },
          hostNames: { hostA: 'Maya', hostB: 'Leo' },
          totalDurationMs: 1_000,
        })
      }
    })

    expect((await asUser.query(api.audioOverviews.listByRoom, { roomId: roomA })).map(row => row.title))
      .toEqual(['Cell episode'])
    expect((await asUser.query(api.audioOverviews.listByRoom, { roomId: roomB })).map(row => row.title))
      .toEqual(['Genetics episode'])
  })

  test('[P0] creates exactly one room for a chat void', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Chemistry' })
    const conversationId = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'Acids and bases',
    })

    const first = await asUser.mutation(api.audioOverviewRooms.create, { folderId, conversationId })
    const second = await asUser.mutation(api.audioOverviewRooms.create, { folderId, conversationId })

    expect(first.created).toBe(true)
    expect(second).toEqual({ roomId: first.roomId, created: false })
    expect((await asUser.query(api.audioOverviews.listByRoom, { roomId: first.roomId }))).toEqual([])
  })
})
