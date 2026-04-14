import { faker } from '@faker-js/faker'

type DocumentStatus = 'processing' | 'success' | 'failed'

interface DocumentData {
  filename: string
  status: DocumentStatus
  fileSize: number
  failureReason?: string
}

interface DocumentDoc extends DocumentData {
  _id: string
  _creationTime: number
  userId: string
  folderId: string
  fileId: string
}

export const createDocument = (overrides: Partial<DocumentDoc> = {}): DocumentDoc => ({
  _id: faker.string.alphanumeric(32),
  _creationTime: Date.now() - faker.number.int({ min: 0, max: 7 * 24 * 60 * 60 * 1000 }),
  userId: faker.string.alphanumeric(32),
  folderId: faker.string.alphanumeric(32),
  fileId: faker.string.alphanumeric(32),
  filename: faker.system.fileName({ extensionCount: 1 }).replace(/\.\w+$/, '.pdf'),
  status: 'processing',
  fileSize: faker.number.int({ min: 1024, max: 50 * 1024 * 1024 }),
  ...overrides,
})

export const createDocuments = (count: number, overrides: Partial<DocumentDoc> = {}): DocumentDoc[] =>
  Array.from({ length: count }, () => createDocument(overrides))
