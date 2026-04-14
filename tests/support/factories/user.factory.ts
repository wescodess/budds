import { faker } from '@faker-js/faker'

interface UserData {
  id: string
  name: string
  email: string
  avatarUrl: string
}

export const createUser = (overrides: Partial<UserData> = {}): UserData => ({
  id: faker.string.uuid(),
  name: faker.person.fullName(),
  email: faker.internet.email(),
  avatarUrl: faker.image.avatar(),
  ...overrides,
})

export const createUsers = (count: number, overrides: Partial<UserData> = {}): UserData[] =>
  Array.from({ length: count }, () => createUser(overrides))
