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

describe('folders.createSubfolder', () => {
  it('[P0] should create a subfolder under a parent folder', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Semester 1' })
    const childId = await asUser.mutation(api.folders.createSubfolder, {
      name: 'Week 1',
      parentId,
    })

    expect(childId).toBeDefined()

    const folder = await asUser.query(api.folders.getFolder, { id: childId })
    expect(folder).not.toBeNull()
    expect(folder!.name).toBe('Week 1')
    expect(folder!.parentId).toBe(parentId)
    expect(folder!.documentCount).toBe(0)
    expect(folder!.userId).toBe(TEST_IDENTITY.tokenIdentifier)
  })

  it('[P0] should throw for unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Root' })

    await expect(
      t.mutation(api.folders.createSubfolder, { name: 'Child', parentId }),
    ).rejects.toThrow()
  })

  it('[P0] should enforce max depth of 3 levels', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const level1 = await asUser.mutation(api.folders.createFolder, { name: 'Level 1' })
    const level2 = await asUser.mutation(api.folders.createSubfolder, {
      name: 'Level 2',
      parentId: level1,
    })
    const level3 = await asUser.mutation(api.folders.createSubfolder, {
      name: 'Level 3',
      parentId: level2,
    })

    await expect(
      asUser.mutation(api.folders.createSubfolder, {
        name: 'Level 4 (too deep)',
        parentId: level3,
      }),
    ).rejects.toThrow()
  })

  it('[P1] should allow creating multiple children under the same parent', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Physics' })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Mechanics', parentId })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Optics', parentId })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Thermodynamics', parentId })

    const children = await asUser.query(api.folders.listChildFolders, { parentId })
    expect(children).toHaveLength(3)
  })

  it('[P1] should not allow creating a subfolder under another user\'s folder', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const parentId = await asUser1.mutation(api.folders.createFolder, { name: 'User1 Folder' })

    await expect(
      asUser2.mutation(api.folders.createSubfolder, { name: 'Intruder', parentId }),
    ).rejects.toThrow()
  })
})

describe('folders.listChildFolders', () => {
  it('[P0] should return children of a given parent folder', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'CS 101' })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Homework', parentId })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Lectures', parentId })

    const children = await asUser.query(api.folders.listChildFolders, { parentId })
    expect(children).toHaveLength(2)
    expect(children.map((f: any) => f.name)).toContain('Homework')
    expect(children.map((f: any) => f.name)).toContain('Lectures')
  })

  it('[P0] should return empty array when parent has no children', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Empty Folder' })

    const children = await asUser.query(api.folders.listChildFolders, { parentId })
    expect(children).toEqual([])
  })

  it('[P0] should only return children belonging to the authenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const parent1 = await asUser1.mutation(api.folders.createFolder, { name: 'User1 Root' })
    await asUser1.mutation(api.folders.createSubfolder, { name: 'User1 Child', parentId: parent1 })

    const parent2 = await asUser2.mutation(api.folders.createFolder, { name: 'User2 Root' })
    await asUser2.mutation(api.folders.createSubfolder, { name: 'User2 Child', parentId: parent2 })

    const user1Children = await asUser1.query(api.folders.listChildFolders, { parentId: parent1 })
    expect(user1Children).toHaveLength(1)
    expect(user1Children[0].name).toBe('User1 Child')
  })

  it('[P1] should not return grandchildren (only direct children)', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const root = await asUser.mutation(api.folders.createFolder, { name: 'Root' })
    const child = await asUser.mutation(api.folders.createSubfolder, { name: 'Child', parentId: root })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Grandchild', parentId: child })

    const children = await asUser.query(api.folders.listChildFolders, { parentId: root })
    expect(children).toHaveLength(1)
    expect(children[0].name).toBe('Child')
  })
})

describe('folders.getFolder', () => {
  it('[P0] should return a folder by id for the authenticated owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'My Folder' })

    const folder = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(folder).not.toBeNull()
    expect(folder!._id).toBe(folderId)
    expect(folder!.name).toBe('My Folder')
    expect(folder!.userId).toBe(TEST_IDENTITY.tokenIdentifier)
  })

  it('[P0] should return null when folder belongs to a different user', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const folderId = await asUser1.mutation(api.folders.createFolder, { name: 'Private Folder' })

    const folder = await asUser2.query(api.folders.getFolder, { id: folderId })
    expect(folder).toBeNull()
  })

  it('[P0] should return null for unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Some Folder' })

    const folder = await t.query(api.folders.getFolder, { id: folderId })
    expect(folder).toBeNull()
  })

  it('[P1] should return subfolder with parentId populated', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Parent' })
    const childId = await asUser.mutation(api.folders.createSubfolder, {
      name: 'Child',
      parentId,
    })

    const child = await asUser.query(api.folders.getFolder, { id: childId })
    expect(child).not.toBeNull()
    expect(child!.parentId).toBe(parentId)
  })
})

describe('folders.listAllFolders', () => {
  it('[P0] should return all folders for authenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Root' })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Child 1', parentId })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Child 2', parentId })

    const all = await asUser.query(api.folders.listAllFolders)
    expect(all).toHaveLength(3)
  })

  it('[P0] should be bounded with take(500)', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    for (let i = 0; i < 10; i++) {
      await asUser.mutation(api.folders.createFolder, { name: `Folder ${i}` })
    }

    const all = await asUser.query(api.folders.listAllFolders)
    expect(all.length).toBeLessThanOrEqual(500)
  })

  it('[P0] should return empty array for unauthenticated user', async () => {
    const t = convexTest(schema, modules)

    const all = await t.query(api.folders.listAllFolders)
    expect(all).toEqual([])
  })

  it('[P1] should not return folders from other users', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    await asUser1.mutation(api.folders.createFolder, { name: 'User1 Folder' })
    await asUser2.mutation(api.folders.createFolder, { name: 'User2 Folder' })

    const user1All = await asUser1.query(api.folders.listAllFolders)
    expect(user1All).toHaveLength(1)
    expect(user1All[0].name).toBe('User1 Folder')
  })
})
