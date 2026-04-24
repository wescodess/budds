import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'

export default defineEventHandler(async (event) => {
  const token = event.context.convexToken as string | undefined
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const convexUrl = process.env.CONVEX_URL || process.env.NUXT_PUBLIC_CONVEX_URL
  if (!convexUrl) {
    throw createError({ statusCode: 500, statusMessage: 'Convex URL not configured' })
  }

  const client = new ConvexHttpClient(convexUrl)
  client.setAuth(token)

  let data
  try {
    data = await client.query(api.dataExport.collectUserData, {})
  } catch (err: any) {
    const message = err?.message || 'Failed to load user data'
    throw createError({ statusCode: 500, statusMessage: message })
  }

  const today = new Date().toISOString().slice(0, 10)
  const filename = `budds-export-${today}.zip`

  setResponseHeader(event, 'Content-Type', 'application/zip')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()

  const unresolvedDocuments: string[] = []

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      writer.abort(err).catch(() => {})
      return
    }
    writer.write(chunk).catch(() => {})
    if (final) {
      writer.close().catch(() => {})
    }
  })

  const addJson = (name: string, value: unknown) => {
    const entry = new ZipDeflate(name, { level: 6 })
    zip.add(entry)
    const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2))
    entry.push(bytes, true)
  }

  ;(async () => {
    try {
      addJson('folders.json', data.folders)
      addJson('documents.json', data.documents)
      addJson('conversations.json', data.conversations)
      addJson('messages.json', data.messages)
      addJson('quizzes.json', data.quizzes ?? [])
      addJson('quizQuestions.json', data.quizQuestions ?? [])
      addJson('quizAttempts.json', data.quizAttempts ?? [])
      addJson('flashcardSets.json', data.flashcardSets ?? [])
      addJson('flashcards.json', data.flashcards ?? [])
      addJson('courses.json', data.courses ?? [])
      addJson('courseSections.json', data.courseSections ?? [])
      addJson('courseSourceDocs.json', data.courseSourceDocs ?? [])
      addJson('learnProfile.json', data.learnProfile ?? [])

      for (const doc of data.documents) {
        const entryName = `documents/${doc._id}.pdf`
        let urlInfo: { url: string | null; filename: string } | null = null
        try {
          urlInfo = await client.query(api.dataExport.getDocumentDownloadUrl, {
            documentId: doc._id,
          })
        } catch {
          unresolvedDocuments.push(String(doc._id))
          continue
        }

        if (!urlInfo || !urlInfo.url) {
          unresolvedDocuments.push(String(doc._id))
          continue
        }

        try {
          const res = await fetch(urlInfo.url)
          if (!res.ok || !res.body) {
            unresolvedDocuments.push(String(doc._id))
            continue
          }
          const entry = new ZipPassThrough(entryName)
          zip.add(entry)
          const reader = res.body.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              entry.push(new Uint8Array(0), true)
              break
            }
            if (value && value.byteLength > 0) entry.push(value, false)
          }
        } catch {
          unresolvedDocuments.push(String(doc._id))
        }
      }

      addJson('manifest.json', {
        schemaVersion: 5,
        exportedAt: new Date().toISOString(),
        userId: data.userId,
        user: data.user
          ? {
              name: data.user.name,
              email: data.user.email ?? null,
            }
          : null,
        counts: {
          folders: data.folders.length,
          documents: data.documents.length,
          conversations: data.conversations.length,
          messages: data.messages.length,
          quizzes: data.quizzes?.length ?? 0,
          quizQuestions: data.quizQuestions?.length ?? 0,
          quizAttempts: data.quizAttempts?.length ?? 0,
          flashcardSets: data.flashcardSets?.length ?? 0,
          flashcards: data.flashcards?.length ?? 0,
          courses: data.courses?.length ?? 0,
          courseSections: data.courseSections?.length ?? 0,
          courseSourceDocs: data.courseSourceDocs?.length ?? 0,
          learnProfile: data.learnProfile?.length ?? 0,
        },
        unresolvedDocuments,
      })

      zip.end()
    } catch (err) {
      try {
        zip.terminate()
      } catch {}
      writer.abort(err as Error).catch(() => {})
    }
  })()

  return sendStream(event, readable as unknown as ReadableStream)
})
