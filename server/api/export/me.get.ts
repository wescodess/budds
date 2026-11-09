import { ConvexHttpClient } from 'convex/browser'
import { ConvexError } from 'convex/values'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { PERSONAL_EXPORT_COLLECTIONS } from '../../../convex/lib/learnV2PersonalExportCollections'
import { LEARN_MEASUREMENT_STORAGE_MANIFEST, LEARN_MEASUREMENT_STORAGE_VERSION } from '../../../shared/learn-v2-measurement-storage-manifest'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { requireRateLimit } from '../../utils/rate-limit'

const EXPORT_PAGE_SIZE = 8

export const EXPORT_COLLECTIONS = PERSONAL_EXPORT_COLLECTIONS

type ExportCollection = typeof EXPORT_COLLECTIONS[number]
type ExportRow = Record<string, unknown> & { _id: string }
type ExportPage = {
  page: ExportRow[]
  isDone: boolean
  continueCursor: string
}
type NonFileBackedDocument = {
  documentId: string
  sourceType: 'website' | 'youtube'
  sourceUrl: string | null
}

function getSafeDocumentExtension(filename: string) {
  const basename = filename.split(/[\\/]/).pop() ?? ''
  const lastDot = basename.lastIndexOf('.')
  if (lastDot <= 0) return '.bin'

  const extension = basename.slice(lastDot)
  return /^\.[a-z0-9]{1,10}$/i.test(extension) ? extension.toLowerCase() : '.bin'
}

function getNonFileBackedDocument(doc: ExportRow): NonFileBackedDocument | null {
  if (doc.fileId || (doc.sourceType !== 'website' && doc.sourceType !== 'youtube')) return null

  return {
    documentId: doc._id,
    sourceType: doc.sourceType,
    sourceUrl: typeof doc.sourceUrl === 'string' ? doc.sourceUrl : null,
  }
}

function encodeJson(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item,
  ))
}

export default defineEventHandler(async (event) => {
  const token = event.context.convexToken as string | undefined
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  await requireRateLimit(event, 3, 'export.me')

  const convexUrl = process.env.CONVEX_URL || process.env.NUXT_PUBLIC_CONVEX_URL
  if (!convexUrl) {
    throw createError({ statusCode: 500, statusMessage: 'Convex URL not configured' })
  }

  const client = new ConvexHttpClient(convexUrl)
  client.setAuth(token)

  const authorize = async () => {
    let authorization = await client.mutation(api.dataExport.authorizePersonalExport, {})
    while (!authorization.done) {
      const next = await client.mutation(api.dataExport.authorizePersonalExport, {
        authorizationId: authorization.authorizationId, cursor: authorization.cursor ?? undefined,
      })
      if (!next.done && next.cursor === authorization.cursor) throw new Error('Export authorization did not advance')
      authorization = next
    }
    return authorization.authorizationId
  }
  let authorizationId = await authorize()
  let reauthorizations = 0
  const authorizedQuery = async <R>(read: (authorizationId: Id<'learnAssessmentExposures'>) => Promise<R>): Promise<R> => {
    while (true) {
      try { return await read(authorizationId) }
      catch (error) {
        if (!(error instanceof ConvexError) || typeof error.data !== 'object' || error.data === null
          || !('code' in error.data) || error.data.code !== 'personal_export_inventory_changed' || reauthorizations >= 3) throw error
        reauthorizations++
        authorizationId = await authorize()
      }
    }
  }

  let metadata
  try {
    metadata = await client.query(api.dataExport.getExportMetadata, {})
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load user data'
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
  const nonFileBackedDocuments: NonFileBackedDocument[] = []
  const counts: Record<string, number> = {}
  let zipWriteError: Error | null = null
  let zipWritePromise: Promise<void> = Promise.resolve()

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      zipWriteError = err
      return
    }

    zipWritePromise = zipWritePromise
      .then(() => writer.write(chunk))
      .then(async () => {
        if (final) await writer.close()
      })
  })

  const flushZipOutput = async () => {
    if (zipWriteError) throw zipWriteError
    await zipWritePromise
    if (zipWriteError) throw zipWriteError
  }

  const readCollection = async function* (collection: ExportCollection): AsyncGenerator<ExportRow> {
    let cursor: string | null = null

    while (true) {
      const result = await authorizedQuery(authorizationId => client.query(api.dataExport.getUserDataPage, {
        collection,
        authorizationId,
        paginationOpts: { cursor, numItems: EXPORT_PAGE_SIZE },
      })) as ExportPage

      for (const row of result.page) yield row
      if (result.isDone) return
      if (!result.continueCursor || result.continueCursor === cursor) {
        throw new Error(`Export pagination did not advance for ${collection}`)
      }
      cursor = result.continueCursor
    }
  }

  const readAttemptAnswers = async function* (): AsyncGenerator<ExportRow> {
    for await (const attempt of readCollection('quizAttempts')) {
      let cursor: string | null = null
      while (true) {
        const result = await authorizedQuery(authorizationId => client.query(api.dataExport.getAttemptAnswersPage, {
          attemptId: attempt._id as Id<'quizAttempts'>,
          authorizationId,
          paginationOpts: { cursor, numItems: EXPORT_PAGE_SIZE },
        })) as ExportPage | null
        if (!result) break

        for (const row of result.page) yield row
        if (result.isDone) break
        if (!result.continueCursor || result.continueCursor === cursor) {
          throw new Error(`Export pagination did not advance for attempt ${attempt._id}`)
        }
        cursor = result.continueCursor
      }
    }
  }

  const readCourseSourceDocs = async function* (): AsyncGenerator<ExportRow> {
    for await (const course of readCollection('courses')) {
      let cursor: string | null = null
      while (true) {
        const result = await authorizedQuery(authorizationId => client.query(api.dataExport.getCourseSourceDocsPage, {
          courseId: course._id as Id<'courses'>,
          authorizationId,
          paginationOpts: { cursor, numItems: EXPORT_PAGE_SIZE },
        })) as ExportPage | null
        if (!result) break

        for (const row of result.page) yield row
        if (result.isDone) break
        if (!result.continueCursor || result.continueCursor === cursor) {
          throw new Error(`Export pagination did not advance for course ${course._id}`)
        }
        cursor = result.continueCursor
      }
    }
  }

  const addJsonStream = async (name: string, rows: AsyncIterable<unknown>) => {
    const entry = new ZipDeflate(name, { level: 6 })
    zip.add(entry)
    entry.push(new TextEncoder().encode('[\n'), false)
    await flushZipOutput()

    let count = 0
    for await (const row of rows) {
      if (count > 0) entry.push(new TextEncoder().encode(',\n'), false)
      entry.push(encodeJson(row), false)
      await flushZipOutput()
      count++
    }

    entry.push(new TextEncoder().encode('\n]\n'), true)
    await flushZipOutput()
    return count
  }

  const addJsonValue = async (name: string, value: unknown) => {
    const entry = new ZipDeflate(name, { level: 6 })
    zip.add(entry)
    entry.push(encodeJson(value), true)
    await flushZipOutput()
  }

  const addDocument = async (doc: ExportRow) => {
    const documentId = doc._id as Id<'documents'>
    const nonFileBackedDocument = getNonFileBackedDocument(doc)
    if (nonFileBackedDocument) {
      nonFileBackedDocuments.push(nonFileBackedDocument)
      return
    }

    const urlInfo = await authorizedQuery(authorizationId => client.query(api.dataExport.getDocumentDownloadUrl, { documentId, authorizationId }))

    if (!urlInfo?.url) {
      unresolvedDocuments.push(String(documentId))
      return
    }

    let response: Response
    try {
      response = await fetch(urlInfo.url)
    }
    catch {
      unresolvedDocuments.push(String(documentId))
      return
    }

    if (!response.ok || !response.body) {
      unresolvedDocuments.push(String(documentId))
      return
    }

    const extension = getSafeDocumentExtension(urlInfo.filename)
    const entry = new ZipPassThrough(`documents/${documentId}${extension}`)
    zip.add(entry)
    const reader = response.body.getReader()

    while (true) {
      const result = await reader.read()

      if (result.done) break
      if (result.value.byteLength > 0) {
        entry.push(result.value, false)
        await flushZipOutput()
      }
    }

    entry.push(new Uint8Array(0), true)
    await flushZipOutput()
  }

  ;(async () => {
    try {
      for (const collection of EXPORT_COLLECTIONS) {
        counts[collection] = await addJsonStream(`${collection}.json`, readCollection(collection))
      }

      counts.attemptAnswers = await addJsonStream('attemptAnswers.json', readAttemptAnswers())
      counts.courseSourceDocs = await addJsonStream('courseSourceDocs.json', readCourseSourceDocs())

      for await (const doc of readCollection('documents')) {
        await addDocument(doc)
      }

      await addJsonValue('manifest.json', {
        schemaVersion: 11,
        assessmentDisclosure: {
          version: 'learn-v2.assessment-disclosure.v1',
          omittedCategories: ['private_scoring', 'unseen_forms', 'private_evidence', 'provider_payloads'],
        },
        measurementStorage: {
          version: LEARN_MEASUREMENT_STORAGE_VERSION,
          policies: LEARN_MEASUREMENT_STORAGE_MANIFEST.map(entry => ({ collection: entry.table, projection: entry.export })),
          omitted: ['unseen_prompts', 'keys', 'private_rubrics', 'solutions', 'private_evidence', 'scorer_payloads', 'assignment_seeds', 'viewer_grants'],
        },
        exportedAt: new Date().toISOString(),
        userId: metadata.userId,
        user: metadata.user,
        counts,
        unresolvedDocuments,
        nonFileBackedDocuments,
      })

      zip.end()
      await flushZipOutput()
    }
    catch (err) {
      try {
        zip.terminate()
      }
      catch {
        // The ZIP may already be terminal after an output-stream failure.
      }
      await writer.abort(err).catch(() => {})
    }
  })()

  return sendStream(event, readable as unknown as ReadableStream)
})
