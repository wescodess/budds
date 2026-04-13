import { faker } from '@faker-js/faker'

interface FolderData {
  name: string
  userId: string
  parentId?: string
  documentCount: number
  description?: string
  color?: string
  icon?: string
}

interface FolderDoc extends FolderData {
  _id: string
  _creationTime: number
}

export const createFolder = (overrides: Partial<FolderDoc> = {}): FolderDoc => ({
  _id: faker.string.alphanumeric(32),
  _creationTime: Date.now() - faker.number.int({ min: 0, max: 30 * 24 * 60 * 60 * 1000 }),
  name: faker.helpers.arrayElement([
    'Math 101',
    'Physics 201',
    'Computer Science 301',
    'Biology 110',
    'English Literature',
    'Chemistry 202',
  ]),
  userId: faker.string.alphanumeric(32),
  documentCount: faker.number.int({ min: 0, max: 25 }),
  description: '',
  color: 'slate-tide',
  icon: 'folder',
  ...overrides,
})

export const createFolders = (count: number, overrides: Partial<FolderDoc> = {}): FolderDoc[] =>
  Array.from({ length: count }, () => createFolder(overrides))
