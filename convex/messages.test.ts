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

async function seedConversation(asUser: ReturnType<ReturnType<typeof convexTest>['withIdentity']>) {
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })
  const conversationId = await asUser.mutation(api.conversations.createConversation, {
    folderId,
    title: 'Chat',
  })
  return { folderId, conversationId }
}

describe('messages.appendMessage', () => {
  it('[P0] should append a user message with userId derived from auth', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { conversationId } = await seedConversation(asUser)

    const msgId = await asUser.mutation(api.messages.appendMessage, {
      conversationId,
      role: 'user',
      content: 'What is photosynthesis?',
    })

    expect(msgId).toBeDefined()

    const messages = await asUser.query(api.messages.listByConversation, { conversationId })
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('What is photosynthesis?')
    expect(messages[0].userId).toBe(TEST_IDENTITY.tokenIdentifier)
    expect(messages[0].conversationId).toBe(conversationId)
  })

  it('[P0] should append an assistant message with sources and model', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { conversationId } = await seedConversation(asUser)

    const sources = [
      { content: 'chunk 1', score: 0.91, filename: 'notes.pdf' },
      { content: 'chunk 2', score: 0.82, filename: 'slides.pdf' },
    ]

    await asUser.mutation(api.messages.appendMessage, {
      conversationId,
      role: 'assistant',
      content: 'Photosynthesis converts light to energy.',
      sources,
      model: 'claude-opus-4-6',
    })

    const messages = await asUser.query(api.messages.listByConversation, { conversationId })
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].sources).toEqual(sources)
    expect(messages[0].model).toBe('claude-opus-4-6')
  })

  it('[P0] should reject appending to another user\'s conversation', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const { conversationId } = await seedConversation(asUser1)

    await expect(
      asUser2.mutation(api.messages.appendMessage, {
        conversationId,
        role: 'user',
        content: 'Intruder',
      }),
    ).rejects.toThrow()
  })

  it('[P1] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { conversationId } = await seedConversation(asUser)

    await expect(
      t.mutation(api.messages.appendMessage, {
        conversationId,
        role: 'user',
        content: 'anon',
      }),
    ).rejects.toThrow()
  })
})

describe('messages.listByConversation', () => {
  it('[P0] should return messages in _creationTime ascending order', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { conversationId } = await seedConversation(asUser)

    await asUser.mutation(api.messages.appendMessage, {
      conversationId,
      role: 'user',
      content: 'Q1',
    })
    await asUser.mutation(api.messages.appendMessage, {
      conversationId,
      role: 'assistant',
      content: 'A1',
    })
    await asUser.mutation(api.messages.appendMessage, {
      conversationId,
      role: 'user',
      content: 'Q2',
    })

    const messages = await asUser.query(api.messages.listByConversation, { conversationId })
    expect(messages.map((m: any) => m.content)).toEqual(['Q1', 'A1', 'Q2'])
  })

  it('[P0] should be scoped to the conversation\'s owner', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const { conversationId } = await seedConversation(asUser1)
    await asUser1.mutation(api.messages.appendMessage, {
      conversationId,
      role: 'user',
      content: 'Private',
    })

    await expect(
      asUser2.query(api.messages.listByConversation, { conversationId }),
    ).rejects.toThrow()
  })

  it('[P0] should return empty array for a conversation with no messages', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { conversationId } = await seedConversation(asUser)

    const messages = await asUser.query(api.messages.listByConversation, { conversationId })
    expect(messages).toEqual([])
  })

  it('[P1] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { conversationId } = await seedConversation(asUser)

    await expect(
      t.query(api.messages.listByConversation, { conversationId }),
    ).rejects.toThrow()
  })
})
