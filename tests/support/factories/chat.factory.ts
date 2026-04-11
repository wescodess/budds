import { faker } from '@faker-js/faker'
import type { Source, UIChatMessage as ChatMessageData } from '~/composables/useChat'

export const createSource = (overrides: Partial<Source> = {}): Source => ({
  content: faker.lorem.paragraph(),
  score: faker.number.float({ min: 0.5, max: 1.0, fractionDigits: 2 }),
  filename: faker.system.fileName({ extensionCount: 1 }).replace(/\.\w+$/, '.pdf'),
  ...overrides,
})

export const createSources = (count: number, overrides: Partial<Source> = {}): Source[] =>
  Array.from({ length: count }, () => createSource(overrides))

export const createChatMessage = (overrides: Partial<ChatMessageData> = {}): ChatMessageData => ({
  role: faker.helpers.arrayElement(['user', 'assistant'] as const),
  content: faker.lorem.sentences(2),
  ...overrides,
})

export const createAssistantMessage = (overrides: Partial<ChatMessageData> = {}): ChatMessageData =>
  createChatMessage({
    role: 'assistant',
    content: 'Based on the lecture notes [1], the answer is photosynthesis [2]. This process converts light energy into chemical energy.',
    sources: createSources(2),
    ...overrides,
  })

export const createUserMessage = (overrides: Partial<ChatMessageData> = {}): ChatMessageData =>
  createChatMessage({
    role: 'user',
    content: faker.lorem.sentence(),
    sources: undefined,
    ...overrides,
  })
