import { expect, test } from 'vitest'
import type { Id } from '../convex/_generated/dataModel'
import { buildV1CoursePath } from './learn-v1-routes'

test('builds the V1 overview destination with each segment encoded once', () => {
  expect(buildV1CoursePath({
    folderId: 'folder /?#%' as Id<'folders'>,
    courseId: 'course/%2F' as Id<'courses'>,
  })).toBe('/app/folders/folder%20%2F%3F%23%25/learn/course%2F%252F')
})
