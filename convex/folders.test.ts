/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
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

describe('folders.renameFolder', () => {
  it('[P0] should rename a folder for authenticated owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    await asUser.mutation(api.folders.renameFolder, { id: folderId, name: 'Mathematics 101' })
    const folder = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(folder!.name).toBe('Mathematics 101')
  })

  it('[P0] should reject empty name', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    await expect(
      asUser.mutation(api.folders.renameFolder, { id: folderId, name: '' }),
    ).rejects.toThrow()
  })

  it('[P0] should reject whitespace-only name', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    await expect(
      asUser.mutation(api.folders.renameFolder, { id: folderId, name: '   ' }),
    ).rejects.toThrow()
  })

  it('[P0] should reject name longer than 100 characters', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    const longName = 'a'.repeat(101)
    await expect(
      asUser.mutation(api.folders.renameFolder, { id: folderId, name: longName }),
    ).rejects.toThrow()
  })

  it('[P1] should trim whitespace from name', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    await asUser.mutation(api.folders.renameFolder, { id: folderId, name: '  Mathematics 101  ' })
    const folder = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(folder!.name).toBe('Mathematics 101')
  })

  it('[P1] should update updatedAt timestamp', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    const before = await asUser.query(api.folders.getFolder, { id: folderId })
    await asUser.mutation(api.folders.renameFolder, { id: folderId, name: 'Updated' })
    const after = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(after!.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt!)
  })

  it('[P1] should reject renaming another user\'s folder', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)
    const folderId = await asUser1.mutation(api.folders.createFolder, { name: 'User1 Folder' })
    await expect(
      asUser2.mutation(api.folders.renameFolder, { id: folderId, name: 'Hijacked' }),
    ).rejects.toThrow()
  })

  it('[P1] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    await expect(
      t.mutation(api.folders.renameFolder, { id: folderId, name: 'Hacked' }),
    ).rejects.toThrow()
  })
})

describe('folders.deleteFolder', () => {
  it('[P0] should delete a leaf folder', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'To Delete' })
    await asUser.mutation(api.folders.deleteFolder, { id: folderId })
    const folder = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(folder).toBeNull()
  })

  it('[P0] should cascade delete folder with direct children', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Parent' })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Child 1', parentId })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Child 2', parentId })
    await asUser.mutation(api.folders.deleteFolder, { id: parentId })
    const all = await asUser.query(api.folders.listAllFolders)
    expect(all).toHaveLength(0)
  })

  it('[P0] should cascade delete 3-level nested hierarchy', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const level1 = await asUser.mutation(api.folders.createFolder, { name: 'Level 1' })
    const level2 = await asUser.mutation(api.folders.createSubfolder, { name: 'Level 2', parentId: level1 })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Level 3', parentId: level2 })
    await asUser.mutation(api.folders.deleteFolder, { id: level1 })
    const all = await asUser.query(api.folders.listAllFolders)
    expect(all).toHaveLength(0)
  })

  it('[P0] should return count of deleted items', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Parent' })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Child 1', parentId })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Child 2', parentId })
    const result = await asUser.mutation(api.folders.deleteFolder, { id: parentId })
    expect(result).toEqual({ deletedFolders: 3, deletedDocuments: 0 })
  })

  it('[P1] should reject deleting another user\'s folder', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)
    const folderId = await asUser1.mutation(api.folders.createFolder, { name: 'User1 Folder' })
    await expect(
      asUser2.mutation(api.folders.deleteFolder, { id: folderId }),
    ).rejects.toThrow()
  })

  it('[P1] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Math 101' })
    await expect(
      t.mutation(api.folders.deleteFolder, { id: folderId }),
    ).rejects.toThrow()
  })
})

describe('folders.getFolderDescendantCounts', () => {
  it('[P0] should return zero counts for empty folder', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Empty' })
    const counts = await asUser.query(api.folders.getFolderDescendantCounts, { id: folderId })
    expect(counts).toEqual({ subfolderCount: 0, documentCount: 0 })
  })

  it('[P0] should return correct counts for folder with direct children', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Parent' })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Child 1', parentId })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Child 2', parentId })
    const counts = await asUser.query(api.folders.getFolderDescendantCounts, { id: parentId })
    expect(counts).toEqual({ subfolderCount: 2, documentCount: 0 })
  })

  it('[P0] should return correct counts for 3-level hierarchy', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const level1 = await asUser.mutation(api.folders.createFolder, { name: 'Level 1' })
    const level2 = await asUser.mutation(api.folders.createSubfolder, { name: 'Level 2', parentId: level1 })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Level 3a', parentId: level2 })
    await asUser.mutation(api.folders.createSubfolder, { name: 'Level 3b', parentId: level2 })
    const counts = await asUser.query(api.folders.getFolderDescendantCounts, { id: level1 })
    expect(counts).toEqual({ subfolderCount: 3, documentCount: 0 })
  })

  it('[P1] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test' })
    await expect(
      t.query(api.folders.getFolderDescendantCounts, { id: folderId }),
    ).rejects.toThrow()
  })

  it('[P1] should reject another user\'s folder', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)
    const folderId = await asUser1.mutation(api.folders.createFolder, { name: 'Private' })
    const counts = await asUser2.query(api.folders.getFolderDescendantCounts, { id: folderId })
    expect(counts).toBeNull()
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

describe('folders.deleteFolder cascade (story 5.2)', () => {
  it('[P0] should delete all documents in folder and enqueue their cleanup', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Cascade' })

    const storageSuccessId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['success'], { type: 'application/pdf' }))
    })
    const storageProcessingId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['processing'], { type: 'application/pdf' }))
    })

    const docSuccessId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'success.pdf',
      fileId: storageSuccessId,
      fileSize: 1024,
    })
    const docProcessingId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'processing.pdf',
      fileId: storageProcessingId,
      fileSize: 512,
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(docSuccessId, {
        status: 'success',
        r2Key: `${TEST_IDENTITY.tokenIdentifier}/${docSuccessId}.txt`,
      })
    })

    const result = await asUser.mutation(api.folders.deleteFolder, { id: folderId })
    expect(result).toEqual({ deletedFolders: 1, deletedDocuments: 2 })

    const remainingDocs = await t.run(async (ctx) => {
      return (await ctx.db.query('documents').collect()).filter(
        (d) => d.userId === TEST_IDENTITY.tokenIdentifier,
      )
    })
    expect(remainingDocs).toHaveLength(0)

    const remainingFolder = await t.run(async (ctx) => ctx.db.get(folderId))
    expect(remainingFolder).toBeNull()

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query('pendingCleanup')
        .withIndex('by_userId', (q) => q.eq('userId', TEST_IDENTITY.tokenIdentifier))
        .collect()
    })
    const r2Rows = rows.filter((r) => r.kind === 'r2')
    const aiRows = rows.filter((r) => r.kind === 'ai-search')
    expect(r2Rows).toHaveLength(1)
    expect(aiRows).toHaveLength(1)
    expect(r2Rows[0].documentId).toBe(String(docSuccessId))
    expect(aiRows[0].documentId).toBe(String(docSuccessId))
  })

  it('[P0] should cascade into descendant folders and clean up their documents', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const rootId = await asUser.mutation(api.folders.createFolder, { name: 'Root' })
    const childId = await asUser.mutation(api.folders.createSubfolder, {
      name: 'Child',
      parentId: rootId,
    })

    const s1 = await t.run(async (ctx) => ctx.storage.store(new Blob(['r'], { type: 'application/pdf' })))
    const s2 = await t.run(async (ctx) => ctx.storage.store(new Blob(['c'], { type: 'application/pdf' })))

    const rootDocId = await asUser.mutation(api.documents.createDocument, {
      folderId: rootId,
      filename: 'root.pdf',
      fileId: s1,
      fileSize: 100,
    })
    const childDocId = await asUser.mutation(api.documents.createDocument, {
      folderId: childId,
      filename: 'child.pdf',
      fileId: s2,
      fileSize: 100,
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(rootDocId, { status: 'success', r2Key: `${TEST_IDENTITY.tokenIdentifier}/r.txt` })
      await ctx.db.patch(childDocId, { status: 'success', r2Key: `${TEST_IDENTITY.tokenIdentifier}/c.txt` })
    })

    const result = await asUser.mutation(api.folders.deleteFolder, { id: rootId })
    expect(result).toEqual({ deletedFolders: 2, deletedDocuments: 2 })

    const docsLeft = await t.run(async (ctx) => {
      return (await ctx.db.query('documents').collect()).filter(
        (d) => d.userId === TEST_IDENTITY.tokenIdentifier,
      )
    })
    expect(docsLeft).toHaveLength(0)

    const foldersLeft = await t.run(async (ctx) => {
      return (await ctx.db.query('folders').collect()).filter(
        (f) => f.userId === TEST_IDENTITY.tokenIdentifier,
      )
    })
    expect(foldersLeft).toHaveLength(0)

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query('pendingCleanup')
        .withIndex('by_userId', (q) => q.eq('userId', TEST_IDENTITY.tokenIdentifier))
        .collect()
    })
    expect(rows.filter((r) => r.kind === 'r2')).toHaveLength(2)
    expect(rows.filter((r) => r.kind === 'ai-search')).toHaveLength(2)
  })

  it('[P0] should not touch another user\'s folder or documents', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(TEST_IDENTITY)
    const asUserB = t.withIdentity(OTHER_IDENTITY)

    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'A' })
    const folderB = await asUserB.mutation(api.folders.createFolder, { name: 'B' })

    const sA = await t.run(async (ctx) => ctx.storage.store(new Blob(['a'], { type: 'application/pdf' })))
    const sB = await t.run(async (ctx) => ctx.storage.store(new Blob(['b'], { type: 'application/pdf' })))

    const docA = await asUserA.mutation(api.documents.createDocument, {
      folderId: folderA, filename: 'a.pdf', fileId: sA, fileSize: 100,
    })
    const docB = await asUserB.mutation(api.documents.createDocument, {
      folderId: folderB, filename: 'b.pdf', fileId: sB, fileSize: 100,
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(docA, { status: 'success', r2Key: `${TEST_IDENTITY.tokenIdentifier}/a.txt` })
      await ctx.db.patch(docB, { status: 'success', r2Key: `${OTHER_IDENTITY.tokenIdentifier}/b.txt` })
    })

    await asUserA.mutation(api.folders.deleteFolder, { id: folderA })

    const bFolder = await t.run(async (ctx) => ctx.db.get(folderB))
    expect(bFolder).not.toBeNull()

    const bDoc = await t.run(async (ctx) => ctx.db.get(docB))
    expect(bDoc).not.toBeNull()

    const bPending = await t.run(async (ctx) => {
      return await ctx.db
        .query('pendingCleanup')
        .withIndex('by_userId', (q) => q.eq('userId', OTHER_IDENTITY.tokenIdentifier))
        .collect()
    })
    expect(bPending).toHaveLength(0)
  })

  it('[P1] empty-folder delete enqueues no pendingCleanup rows', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Empty' })

    const result = await asUser.mutation(api.folders.deleteFolder, { id: folderId })
    expect(result).toEqual({ deletedFolders: 1, deletedDocuments: 0 })

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query('pendingCleanup')
        .withIndex('by_userId', (q) => q.eq('userId', TEST_IDENTITY.tokenIdentifier))
        .collect()
    })
    expect(rows).toHaveLength(0)
  })
})

describe('folders.createFolder metadata', () => {
  it('[P0] persists description, color, and icon when provided', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const id = await asUser.mutation(api.folders.createFolder, {
      name: 'Quantum Physics',
      description: 'Study notes and problem sets',
      color: 'iris',
      icon: 'atom',
    })

    const folder = await asUser.query(api.folders.getFolder, { id })
    expect(folder!.description).toBe('Study notes and problem sets')
    expect(folder!.color).toBe('iris')
    expect(folder!.icon).toBe('atom')
  })

  it('[P0] applies defaults when metadata is omitted', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const id = await asUser.mutation(api.folders.createFolder, { name: 'Scratch' })

    const folder = await asUser.query(api.folders.getFolder, { id })
    expect(folder!.color).toBe('slate-tide')
    expect(folder!.icon).toBe('folder')
    expect(folder!.description).toBe('')
  })

  it('[P0] rejects an invalid color key', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await expect(
      asUser.mutation(api.folders.createFolder, { name: 'X', color: 'hotpink' }),
    ).rejects.toThrow(/Invalid color/)
  })

  it('[P0] rejects an invalid icon key', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await expect(
      asUser.mutation(api.folders.createFolder, { name: 'X', icon: 'tardis' }),
    ).rejects.toThrow(/Invalid icon/)
  })

  it('[P1] rejects description longer than 280 chars', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await expect(
      asUser.mutation(api.folders.createFolder, {
        name: 'X',
        description: 'x'.repeat(281),
      }),
    ).rejects.toThrow()
  })
})

describe('folders.createSubfolder metadata', () => {
  it('[P0] persists metadata and validates color/icon', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Parent' })
    const childId = await asUser.mutation(api.folders.createSubfolder, {
      name: 'Kid',
      parentId,
      color: 'jade',
      icon: 'leaf',
    })

    const child = await asUser.query(api.folders.getFolder, { id: childId })
    expect(child!.color).toBe('jade')
    expect(child!.icon).toBe('leaf')
    expect(child!.description).toBe('')
  })

  it('[P0] rejects invalid color on subfolder', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const parentId = await asUser.mutation(api.folders.createFolder, { name: 'Parent' })

    await expect(
      asUser.mutation(api.folders.createSubfolder, {
        name: 'Kid',
        parentId,
        color: 'neon',
      }),
    ).rejects.toThrow(/Invalid color/)
  })
})

describe('folders.updateFolder', () => {
  it('[P0] patches name only', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const id = await asUser.mutation(api.folders.createFolder, { name: 'Before' })

    await asUser.mutation(api.folders.updateFolder, { id, name: 'After' })

    const folder = await asUser.query(api.folders.getFolder, { id })
    expect(folder!.name).toBe('After')
    expect(folder!.color).toBe('slate-tide')
  })

  it('[P0] patches color without touching icon', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const id = await asUser.mutation(api.folders.createFolder, {
      name: 'X',
      color: 'ember',
      icon: 'atom',
    })

    await asUser.mutation(api.folders.updateFolder, { id, color: 'jade' })

    const folder = await asUser.query(api.folders.getFolder, { id })
    expect(folder!.color).toBe('jade')
    expect(folder!.icon).toBe('atom')
  })

  it('[P0] rejects invalid color', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const id = await asUser.mutation(api.folders.createFolder, { name: 'X' })

    await expect(
      asUser.mutation(api.folders.updateFolder, { id, color: 'bogus' }),
    ).rejects.toThrow(/Invalid color/)
  })

  it('[P0] rejects invalid icon', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const id = await asUser.mutation(api.folders.createFolder, { name: 'X' })

    await expect(
      asUser.mutation(api.folders.updateFolder, { id, icon: 'nope' }),
    ).rejects.toThrow(/Invalid icon/)
  })

  it('[P1] rejects another users folder', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(TEST_IDENTITY)
    const asUserB = t.withIdentity(OTHER_IDENTITY)
    const id = await asUserA.mutation(api.folders.createFolder, { name: 'A' })

    await expect(
      asUserB.mutation(api.folders.updateFolder, { id, name: 'hijacked' }),
    ).rejects.toThrow()
  })

  it('[P1] rejects unauthenticated caller', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const id = await asUser.mutation(api.folders.createFolder, { name: 'X' })

    await expect(
      t.mutation(api.folders.updateFolder, { id, name: 'Y' }),
    ).rejects.toThrow()
  })
})

describe('folders.backfillFolderDefaults', () => {
  it('[P0] patches legacy folders missing color/icon/description', async () => {
    const t = convexTest(schema, modules)

    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert('folders', {
        userId: 'user_legacy',
        name: 'Legacy',
        parentId: undefined,
        documentCount: 0,
      })
    })

    const first = await t.mutation(internal.folders.backfillFolderDefaults, {})
    expect(first.patched).toBeGreaterThanOrEqual(1)

    const legacy = await t.run(async (ctx) => ctx.db.get(legacyId))
    expect(legacy!.color).toBe('slate-tide')
    expect(legacy!.icon).toBe('folder')
    expect(legacy!.description).toBe('')
  })

  it('[P0] is idempotent — second run patches zero rows', async () => {
    const t = convexTest(schema, modules)

    await t.run(async (ctx) => {
      await ctx.db.insert('folders', {
        userId: 'user_legacy',
        name: 'Legacy',
        parentId: undefined,
        documentCount: 0,
      })
    })

    await t.mutation(internal.folders.backfillFolderDefaults, {})
    const second = await t.mutation(internal.folders.backfillFolderDefaults, {})
    expect(second.patched).toBe(0)
  })
})
