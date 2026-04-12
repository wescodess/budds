/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const TEST_IDENTITY = {
  tokenIdentifier: 'https://auth.example.com|user_123',
  name: 'Test User',
  email: 'test@example.com',
}

const OTHER_IDENTITY = {
  tokenIdentifier: 'https://auth.example.com|user_456',
  name: 'Other User',
  email: 'other@example.com',
}

describe('conversations.createConversation', () => {
  it('[P0] should create a conversation with userId derived from auth identity', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    const convoId = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'What is photosynthesis?',
    })

    expect(convoId).toBeDefined()

    const convo = await asUser.query(api.conversations.getConversation, { id: convoId })
    expect(convo).not.toBeNull()
    expect(convo!.userId).toBe(TEST_IDENTITY.tokenIdentifier)
    expect(convo!.folderId).toBe(folderId)
    expect(convo!.title).toBe('What is photosynthesis?')
  })

  it('[P0] should reject creating a conversation in another user\'s folder', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const folderId = await asUser1.mutation(api.folders.createFolder, { name: 'Private Folder' })

    await expect(
      asUser2.mutation(api.conversations.createConversation, {
        folderId,
        title: 'Intruder chat',
      }),
    ).rejects.toThrow()
  })

  it('[P0] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })

    await expect(
      t.mutation(api.conversations.createConversation, { folderId, title: 'hi' }),
    ).rejects.toThrow()
  })

  it('[P1] should truncate title longer than 60 chars', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })

    const longTitle = 'a'.repeat(200)
    const convoId = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: longTitle,
    })

    const convo = await asUser.query(api.conversations.getConversation, { id: convoId })
    expect(convo!.title.length).toBeLessThanOrEqual(60)
  })
})

describe('conversations.listRecentForUser', () => {
  it('[P0] should return only the current user\'s conversations across all folders', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const user1Folder = await asUser1.mutation(api.folders.createFolder, { name: 'U1 Folder' })
    const user2Folder = await asUser2.mutation(api.folders.createFolder, { name: 'U2 Folder' })

    await asUser1.mutation(api.conversations.createConversation, {
      folderId: user1Folder,
      title: 'U1 Chat A',
    })
    await asUser1.mutation(api.conversations.createConversation, {
      folderId: user1Folder,
      title: 'U1 Chat B',
    })
    await asUser2.mutation(api.conversations.createConversation, {
      folderId: user2Folder,
      title: 'U2 Chat',
    })

    const user1Recent = await asUser1.query(api.conversations.listRecentForUser)
    expect(user1Recent).toHaveLength(2)
    expect(user1Recent.every((c: any) => c.userId === TEST_IDENTITY.tokenIdentifier)).toBe(true)
    expect(user1Recent.map((c: any) => c.title)).not.toContain('U2 Chat')
  })

  it('[P0] should order conversations by _creationTime descending', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })
    const first = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'First',
    })
    const second = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'Second',
    })
    const third = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'Third',
    })

    const recent = await asUser.query(api.conversations.listRecentForUser)
    expect(recent[0]._id).toBe(third)
    expect(recent[1]._id).toBe(second)
    expect(recent[2]._id).toBe(first)
  })

  it('[P0] should cap results at 20', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })

    for (let i = 0; i < 25; i++) {
      await asUser.mutation(api.conversations.createConversation, {
        folderId,
        title: `Chat ${i}`,
      })
    }

    const recent = await asUser.query(api.conversations.listRecentForUser)
    expect(recent.length).toBeLessThanOrEqual(20)
  })

  it('[P0] should enrich each row with folderName', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Biology 110' })
    await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'About mitosis',
    })

    const recent = await asUser.query(api.conversations.listRecentForUser)
    expect(recent).toHaveLength(1)
    expect(recent[0].folderName).toBe('Biology 110')
  })

  it('[P1] should return empty array for unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const recent = await t.query(api.conversations.listRecentForUser)
    expect(recent).toEqual([])
  })
})

describe('conversations.getMostRecentForFolder', () => {
  it('[P0] should return the newest conversation for that folder', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })
    await asUser.mutation(api.conversations.createConversation, { folderId, title: 'Older' })
    const newestId = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'Newer',
    })

    const result = await asUser.query(api.conversations.getMostRecentForFolder, { folderId })
    expect(result).not.toBeNull()
    expect(result!._id).toBe(newestId)
    expect(result!.title).toBe('Newer')
  })

  it('[P0] should return null when folder has no conversations', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Empty' })
    const result = await asUser.query(api.conversations.getMostRecentForFolder, { folderId })
    expect(result).toBeNull()
  })

  it('[P0] should not return another user\'s conversation', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const folderId = await asUser1.mutation(api.folders.createFolder, { name: 'U1 Folder' })
    await asUser1.mutation(api.conversations.createConversation, { folderId, title: 'Private' })

    const result = await asUser2.query(api.conversations.getMostRecentForFolder, { folderId })
    expect(result).toBeNull()
  })
})

describe('conversations.getConversation', () => {
  it('[P0] should return conversation for the owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'F' })
    const convoId = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'Hello',
    })

    const convo = await asUser.query(api.conversations.getConversation, { id: convoId })
    expect(convo).not.toBeNull()
    expect(convo!._id).toBe(convoId)
  })

  it('[P0] should return null when conversation belongs to a different user', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const folderId = await asUser1.mutation(api.folders.createFolder, { name: 'F' })
    const convoId = await asUser1.mutation(api.conversations.createConversation, {
      folderId,
      title: 'Private',
    })

    const result = await asUser2.query(api.conversations.getConversation, { id: convoId })
    expect(result).toBeNull()
  })
})

describe('conversations.deleteConversation', () => {
  it('[P0] should delete the conversation and cascade all its messages', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'F' })
    const convoId = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'To Delete',
    })

    await asUser.mutation(api.messages.appendMessage, {
      conversationId: convoId,
      role: 'user',
      content: 'Q1',
    })
    await asUser.mutation(api.messages.appendMessage, {
      conversationId: convoId,
      role: 'assistant',
      content: 'A1',
    })

    await asUser.mutation(api.conversations.deleteConversation, { id: convoId })

    const convo = await asUser.query(api.conversations.getConversation, { id: convoId })
    expect(convo).toBeNull()

    await expect(
      asUser.query(api.messages.listByConversation, { conversationId: convoId }),
    ).rejects.toThrow()
  })

  it('[P0] should not delete another user\'s messages when cascading', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const folder1 = await asUser1.mutation(api.folders.createFolder, { name: 'U1' })
    const folder2 = await asUser2.mutation(api.folders.createFolder, { name: 'U2' })

    const convo1 = await asUser1.mutation(api.conversations.createConversation, {
      folderId: folder1,
      title: 'U1 chat',
    })
    const convo2 = await asUser2.mutation(api.conversations.createConversation, {
      folderId: folder2,
      title: 'U2 chat',
    })

    await asUser1.mutation(api.messages.appendMessage, {
      conversationId: convo1,
      role: 'user',
      content: 'U1 msg',
    })
    await asUser2.mutation(api.messages.appendMessage, {
      conversationId: convo2,
      role: 'user',
      content: 'U2 msg',
    })

    await asUser1.mutation(api.conversations.deleteConversation, { id: convo1 })

    const u2Messages = await asUser2.query(api.messages.listByConversation, {
      conversationId: convo2,
    })
    expect(u2Messages).toHaveLength(1)
    expect(u2Messages[0].content).toBe('U2 msg')
  })

  it('[P1] should reject deleting another user\'s conversation', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const folderId = await asUser1.mutation(api.folders.createFolder, { name: 'F' })
    const convoId = await asUser1.mutation(api.conversations.createConversation, {
      folderId,
      title: 'Private',
    })

    await expect(
      asUser2.mutation(api.conversations.deleteConversation, { id: convoId }),
    ).rejects.toThrow()
  })

  it('[P1] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'F' })
    const convoId = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'Mine',
    })

    await expect(
      t.mutation(api.conversations.deleteConversation, { id: convoId }),
    ).rejects.toThrow()
  })
})
