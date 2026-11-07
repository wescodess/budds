import type { Id } from '../convex/_generated/dataModel'

export function buildV1CoursePath({ folderId, courseId }: {
  folderId: Id<'folders'>
  courseId: Id<'courses'>
}) {
  return `/app/folders/${encodeURIComponent(folderId)}/learn/${encodeURIComponent(courseId)}`
}
