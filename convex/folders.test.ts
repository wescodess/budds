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

describe('folders.listTopLevelFolders', () => {
  it('[P0] should return empty array for user with no folders', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folders = await asUser.query(api.folders.listTopLevelFolders)
    expect(folders).toEqual([])
  })

  it('[P0] should return folders for authenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    await asUser.mutation(api.folders.createFolder, { name: 'Physics 201' })

    const folders = await asUser.query(api.folders.listTopLevelFolders)
    expect(folders).toHaveLength(2)
    expect(folders.map((f: any) => f.name)).toContain('Math 101')
    expect(folders.map((f: any) => f.name)).toContain('Physics 201')
  })

  it('[P0] should only return folders belonging to the authenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    await asUser1.mutation(api.folders.createFolder, { name: 'User 1 Folder' })
    await asUser2.mutation(api.folders.createFolder, { name: 'User 2 Folder' })

    const user1Folders = await asUser1.query(api.folders.listTopLevelFolders)
    expect(user1Folders).toHaveLength(1)
    expect(user1Folders[0].name).toBe('User 1 Folder')

    const user2Folders = await asUser2.query(api.folders.listTopLevelFolders)
    expect(user2Folders).toHaveLength(1)
    expect(user2Folders[0].name).toBe('User 2 Folder')
  })

  it('[P0] should return empty array for unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const folders = await t.query(api.folders.listTopLevelFolders)
    expect(folders).toEqual([])
  })

  it('[P1] should return at most 50 folders', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    for (let i = 0; i < 55; i++) {
      await asUser.mutation(api.folders.createFolder, { name: `Course ${i}` })
    }

    const folders = await asUser.query(api.folders.listTopLevelFolders)
    expect(folders.length).toBeLessThanOrEqual(50)
  })

  it('[P1] should only return top-level folders (parentId undefined)', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await asUser.mutation(api.folders.createFolder, { name: 'Top Level Folder' })

    const folders = await asUser.query(api.folders.listTopLevelFolders)
    expect(folders).toHaveLength(1)
    expect(folders[0].name).toBe('Top Level Folder')
  })
})

describe('folders.createFolder', () => {
  it('[P0] should create a folder with correct fields for authenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await asUser.mutation(api.folders.createFolder, { name: 'Biology 110' })

    const folders = await asUser.query(api.folders.listTopLevelFolders)
    expect(folders).toHaveLength(1)

    const folder = folders[0]
    expect(folder.name).toBe('Biology 110')
    expect(folder.documentCount).toBe(0)
    expect(folder.userId).toBe(TEST_IDENTITY.tokenIdentifier)
  })

  it('[P0] should derive userId from auth identity, not from arguments', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await asUser.mutation(api.folders.createFolder, { name: 'Test Folder' })

    const folders = await asUser.query(api.folders.listTopLevelFolders)
    expect(folders[0].userId).toBe(TEST_IDENTITY.tokenIdentifier)
  })

  it('[P0] should throw for unauthenticated user', async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.folders.createFolder, { name: 'Unauthorized Folder' }),
    ).rejects.toThrow()
  })

  it('[P1] should set parentId to undefined for top-level folders', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await asUser.mutation(api.folders.createFolder, { name: 'Top Level' })

    const folders = await asUser.query(api.folders.listTopLevelFolders)
    expect(folders[0].parentId).toBeUndefined()
  })

  it('[P1] should set documentCount to 0 by default', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await asUser.mutation(api.folders.createFolder, { name: 'New Folder' })

    const folders = await asUser.query(api.folders.listTopLevelFolders)
    expect(folders[0].documentCount).toBe(0)
  })
})
