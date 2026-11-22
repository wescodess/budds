import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ChatMessage } from '../../utils/ai-gateway'
import type { AISearchChunk } from '../../utils/ai-search'
import { requireRateLimit } from '../../utils/rate-limit'
import { createHelpAdmissionGuard } from '../../utils/learn-v2-help-admission'
import { makeConvexClient } from '../../utils/convex-client'
import { loadTeachingScope, assertTeachingSourcePins, TeachingSourceError } from '../../utils/teaching-source-scope'
import { messageProvenance, StreamMessageContent } from '../../utils/message-provenance'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../../shared/learn-v2-measurement-storage-manifest'
import type { LearnHelpReference } from '../../../convex/lib/learnV2HelpContract'
import { normalizeAssistantCitations } from '../../../shared/assistant-citations'

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions based on the provided context.
Use the context below to answer the user's question accurately.
If the context doesn't contain enough information to answer, say so clearly.
When citing sources, use inline numbered references like [1], [2], etc. corresponding to the provided source passages. Each number maps to the source passage at that index.
Use only the [N] format for citations.
Do not write citations as (Source 1), Source 1, or [Source 1: filename].
Do not include a trailing "References" or "Sources" section in the answer.
Do not repeat source filenames in the answer body unless the user explicitly asks for them.`

function folderDocToChunk(
  doc: { key: string; documentId: string; folderId?: string; filename?: string; content: string; contentHash?: string; sourceRevision?: string },
  userId: string,
): AISearchChunk {
  return {
    id: doc.key,
    content: doc.content,
    score: 1,
    attributes: {
      filename: doc.filename,
      folderId: doc.folderId,
      documentId: doc.documentId,
      userId,
      contentHash: doc.contentHash,
      sourceRevision: doc.sourceRevision,
    },
  }
}

function chunkLabel(chunk: AISearchChunk) {
  return chunk.attributes?.filename || chunk.attributes?.url || 'unknown'
}

function buildChunkContext(chunks: AISearchChunk[]) {
  return chunks
    .map((chunk, i) => `[Source ${i + 1}: ${chunkLabel(chunk)}]\n${chunk.content}`)
    .join('\n\n---\n\n')
}

function buildFolderDocContext(folderDocs: Array<{
  documentId: string
  filename?: string
  content: string
}>) {
  return folderDocs
    .map((doc, i) => `[Source ${i + 1}: ${doc.filename ?? doc.documentId}]\n${doc.content}`)
    .join('\n\n---\n\n')
}

function chunkToSource(chunk: AISearchChunk) {
  return {
    content: chunk.content,
    score: chunk.score,
    attributes: chunk.attributes,
  }
}

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, 20, 'rag.chat')
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    query: string
    model: string
    folderId: string
    history?: ChatMessage[]
    max_num_results?: number
    score_threshold?: number
    temperature?: number
    max_tokens?: number
    stream?: boolean
    scope?: {
      folderIds?: string[]
      fileIds?: string[]
    }
  }>(event)

  if (!body.query?.trim()) {
    throw createError({ statusCode: 400, message: 'query is required' })
  }

  if (!body.model?.trim()) {
    throw createError({ statusCode: 400, message: 'model is required' })
  }

  const requestedModel = body.model
  let modelFallback: { requested: string; actual: string } | undefined
  if (!isAllowedModel(requestedModel)) {
    body.model = SERVER_DEFAULT_MODEL
    modelFallback = { requested: requestedModel, actual: SERVER_DEFAULT_MODEL }
  }

  if (!body.folderId?.trim()) {
    throw createError({ statusCode: 400, message: 'folderId is required' })
  }

  const hasScope = Boolean(
    (body.scope?.folderIds?.length ?? 0) > 0 || (body.scope?.fileIds?.length ?? 0) > 0,
  )
  const references: LearnHelpReference[] = hasScope
    ? [...(body.scope?.folderIds ?? []).map(id => ({ kind: 'folder' as const, id: id as Id<'folders'> })),
        ...(body.scope?.fileIds ?? []).map(id => ({ kind: 'document' as const, id: id as Id<'documents'> }))]
    : [{ kind: 'folder', id: body.folderId as Id<'folders'> }]
  // Unbound client history may originate outside the selected scope.
  const client = makeConvexClient(event)
  if (LEARN_MEASUREMENT_CAPABILITIES.responses && !client) throw createError({ statusCode: 503, message: 'Convex client unavailable' })
  const authorizeHelp = createHelpAdmissionGuard(event, { kind: 'chat', scope: body.history?.length ? null : { references } }, client ?? undefined)
  await authorizeHelp()
  let scopedDocumentIds: Set<string> | null = hasScope ? new Set() : null
  let scopedDocuments: Array<{
    documentId: string
    folderId: string
    filename?: string
    r2Key?: string
  }> = []
  if (hasScope) {
    if (!client) throw createError({ statusCode: 500, message: 'Convex client not configured' })
    const resolved = await client.query(api.folders.resolveScope, {
      folderIds: body.scope?.folderIds as Id<'folders'>[] | undefined,
      fileIds: body.scope?.fileIds as Id<'documents'>[] | undefined,
    })

    scopedDocumentIds = new Set((resolved.documentIds ?? []) as string[])
    scopedDocuments = (resolved.documents ?? []).map(doc => ({
      documentId: String(doc.id),
      folderId: String(doc.folderId),
      filename: doc.filename,
      r2Key: doc.r2Key,
    }))
  }

  const teachingScope = await loadTeachingScope(client, hasScope
    ? { documentIds: [...(scopedDocumentIds ?? [])] as Id<'documents'>[] }
    : { folderId: body.folderId as Id<'folders'> })
  let usedChunks: AISearchChunk[] = []
  const authorizeContent = async (delivery = false) => {
    const current = await loadTeachingScope(client, { documentIds: teachingScope?.map(source => source.documentId) })
    for (const source of teachingScope ?? []) assertTeachingSourcePins(current, source)
    for (const chunk of usedChunks) assertTeachingSourcePins(current, chunk.attributes)
    await authorizeHelp(delivery)
  }

  await authorizeContent()
  const searchResults = await searchDocuments({
    teachingScope,
    query: body.query,
    userId,
    ...(hasScope ? {} : { folderId: body.folderId }),
    ...(LEARN_MEASUREMENT_CAPABILITIES.responses && scopedDocumentIds ? { filterDocIds: [...scopedDocumentIds] } : {}),
    max_num_results: body.max_num_results ?? 50,
    score_threshold: body.score_threshold ?? 0.05,
  })

  await authorizeContent()
  const allChunks = (searchResults.data ?? []) as AISearchChunk[]
  const chunks = scopedDocumentIds
    ? allChunks.filter((c) => {
        const docId = c.attributes?.documentId
        return typeof docId === 'string' && scopedDocumentIds!.has(docId)
      })
    : allChunks
  const explicitScopedFileIds = new Set((body.scope?.fileIds ?? []).map(String))
  const chunkDocumentIds = new Set(
    chunks
      .map(chunk => chunk.attributes?.documentId)
      .filter((documentId): documentId is string => typeof documentId === 'string'),
  )

  const summarizationIntent = /\b(summari[sz]e|summary|overview|outline|tl;?dr|main points|key points|what(?:'s| is| are) (?:in|this|these|the)\b|tell me about)\b/i.test(body.query)
  const needsFallback = chunks.length < 3 || summarizationIntent

  let context: string
  let citationChunks: AISearchChunk[]
  if (hasScope) {
    if (!needsFallback) {
      citationChunks = chunks

      const missingExplicitDocuments = explicitScopedFileIds.size > 0
        ? scopedDocuments.filter(doc =>
            explicitScopedFileIds.has(doc.documentId) && !chunkDocumentIds.has(doc.documentId),
          )
        : []

      if (missingExplicitDocuments.length > 0) {
        await authorizeContent()
        try {
          const explicitFolderDocs = await fetchFolderDocs({
            userId,
            documents: missingExplicitDocuments,
            teachingScope: teachingScope?.filter(source => missingExplicitDocuments.some(doc => doc.documentId === source.documentId)),
            maxChars: 80_000,
          })
          if (explicitFolderDocs.length > 0) {
            citationChunks = [
              ...chunks,
              ...explicitFolderDocs.map((doc) => folderDocToChunk(doc, userId)),
            ]
          }
        } catch (error) {
          if (error instanceof TeachingSourceError) throw error
          console.error('[rag/chat] Explicit scoped document retrieval failed')
        }
      }

      context = buildChunkContext(citationChunks)
    }
    else {
      let scopedFolderDocs: Awaited<ReturnType<typeof fetchFolderDocs>> = []
      if (scopedDocuments.length > 0) {
        await authorizeContent()
        try {
          scopedFolderDocs = await fetchFolderDocs({
            userId,
            documents: scopedDocuments,
            teachingScope,
            maxChars: 80_000,
          })
        } catch (error) {
          if (error instanceof TeachingSourceError) throw error
          console.error('[rag/chat] Scoped document retrieval failed')
        }
      }

      if (scopedFolderDocs.length > 0) {
        citationChunks = scopedFolderDocs.map((doc) => folderDocToChunk(doc, userId))
        context = buildFolderDocContext(scopedFolderDocs)
      } else if (chunks.length < 8 && summarizationIntent) {
        await authorizeContent()
        const deepSearch = await searchDocuments({
          teachingScope,
          query: body.query,
          userId,
          ...(hasScope ? {} : { folderId: body.folderId }),
          max_num_results: 40,
          score_threshold: 0.05,
          filterDocIds: scopedDocumentIds ? [...scopedDocumentIds] : undefined,
        })
        const deepChunks = (deepSearch.data ?? []) as AISearchChunk[]
        citationChunks = deepChunks.length > chunks.length ? deepChunks : chunks
        context = buildChunkContext(citationChunks)
      } else {
        citationChunks = chunks
        context = buildChunkContext(chunks)
      }
    }
  } else if (needsFallback) {
    await authorizeContent()
    let rawFolderDocs: Awaited<ReturnType<typeof fetchFolderDocs>> = []
    try {
      rawFolderDocs = await fetchFolderDocs({ teachingScope, userId, folderId: body.folderId, maxChars: 80_000 })
    } catch (error) {
      if (error instanceof TeachingSourceError) throw error
      console.error('[rag/chat] Folder document retrieval failed')
    }
    const folderDocs = scopedDocumentIds
      ? rawFolderDocs.filter((d) => scopedDocumentIds!.has(d.documentId))
      : rawFolderDocs
    if (folderDocs.length > 0) {
      citationChunks = folderDocs.map((doc) => folderDocToChunk(doc, userId))
      context = buildFolderDocContext(folderDocs)
    }
    else if (chunks.length < 8 && summarizationIntent) {
      await authorizeContent()
      const deepSearch = await searchDocuments({
          teachingScope,
        query: body.query,
        userId,
        folderId: body.folderId,
        max_num_results: 40,
        score_threshold: 0.05,
      })
      const deepChunks = (deepSearch.data ?? []) as AISearchChunk[]
      citationChunks = deepChunks.length > chunks.length ? deepChunks : chunks
      context = buildChunkContext(citationChunks)
    }
    else {
      citationChunks = chunks
      context = buildChunkContext(chunks)
    }
  }
  else {
    citationChunks = chunks
    context = buildChunkContext(chunks)
  }

  const responseSources = citationChunks.map(chunkToSource)
  usedChunks = citationChunks

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ]

  if (context) {
    messages.push({
      role: 'user',
      content: `Context:\n${context}`,
    })
    messages.push({
      role: 'assistant',
      content: 'I\'ve reviewed the provided context. How can I help you?',
    })
  }

  if (body.history?.length) {
    const safeHistory = body.history.filter(
      (m): m is ChatMessage => m.role === 'user' || m.role === 'assistant',
    )
    messages.push(...safeHistory)
  }

  messages.push({ role: 'user', content: body.query })

  const completionParams = {
    messages,
    ...(LEARN_MEASUREMENT_CAPABILITIES.responses ? { redactUpstreamErrorBody: true } : {}),
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  }

  if (body.stream) {
    await authorizeContent()
    let stream: ReadableStream
    try {
      stream = await generateCompletionStream({ model: body.model, ...completionParams, stream: true })
    } catch (error) {
      if (body.model !== SERVER_DEFAULT_MODEL) {
        await authorizeContent()
        modelFallback = { requested: body.model, actual: SERVER_DEFAULT_MODEL }
        stream = await generateCompletionStream({ model: SERVER_DEFAULT_MODEL, ...completionParams, stream: true }).catch((fallbackError: unknown) => {
          if (!LEARN_MEASUREMENT_CAPABILITIES.responses) throw fallbackError
          throw createError({ statusCode: 502, message: 'Help generation unavailable' })
        })
      } else {
        if (!LEARN_MEASUREMENT_CAPABILITIES.responses) throw error
        throw createError({ statusCode: 502, message: 'Help generation unavailable' })
      }
    }

    const encoder = new TextEncoder()
    const fallbackEvent = modelFallback
      ? `event: model-fallback\ndata: ${JSON.stringify(modelFallback)}\n\n`
      : ''
    const sourcesEvent = `event: sources\ndata: ${JSON.stringify(responseSources)}\n\n`

    const reader = stream.getReader()
    const answer = new StreamMessageContent()
    let started = false
    let delivered = false
    let pending: Uint8Array[] = []
    const transformedStream = new ReadableStream({
      async pull(controller) {
        try {
          if (!started) {
            await authorizeContent(responseSources.length > 0)
            if (fallbackEvent) controller.enqueue(encoder.encode(fallbackEvent))
            controller.enqueue(encoder.encode(sourcesEvent))
            delivered = responseSources.length > 0
            started = true
            return
          }
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              const text = LEARN_MEASUREMENT_CAPABILITIES.responses ? answer.value() : null
              const provenance = text === null ? undefined : await messageProvenance(event, userId, text, citationChunks, Boolean(body.history?.length))
              await authorizeContent()
              if (provenance) controller.enqueue(encoder.encode(`event: provenance\ndata: ${JSON.stringify(provenance)}\n\n`))
              controller.close()
              reader.releaseLock()
              return
            }
            if (LEARN_MEASUREMENT_CAPABILITIES.responses) answer.append(value)
            if (LEARN_MEASUREMENT_CAPABILITIES.responses && !delivered && !answer.hasContent()) {
              await authorizeContent()
              pending.push(value)
              continue
            }
            let output = value
            if (pending.length) {
              output = new Uint8Array(pending.reduce((size, chunk) => size + chunk.byteLength, value.byteLength))
              let offset = 0
              for (const chunk of [...pending, value]) { output.set(chunk, offset); offset += chunk.byteLength }
              pending = []
            }
            await authorizeContent(true)
            controller.enqueue(output)
            delivered = true
            return
          }
        } catch (error) {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
          controller.error(!LEARN_MEASUREMENT_CAPABILITIES.responses ? error : (error as { data?: { status?: string } }).data?.status === 'denied'
            ? error : createError({ statusCode: 502, message: 'Help stream unavailable' }))
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => {})
        reader.releaseLock()
      },
    }, { highWaterMark: 0 })

    setResponseHeader(event, 'Content-Type', 'text/event-stream')
    setResponseHeader(event, 'Cache-Control', 'no-cache')
    setResponseHeader(event, 'Connection', 'keep-alive')

    return sendStream(event, transformedStream)
  }

  let completion: Awaited<ReturnType<typeof generateCompletion>>
  await authorizeContent()
  try {
    completion = await generateCompletion({ model: body.model, ...completionParams })
  } catch (err) {
    if (body.model !== SERVER_DEFAULT_MODEL) {
      await authorizeContent()
      modelFallback = { requested: body.model, actual: SERVER_DEFAULT_MODEL }
      completion = await generateCompletion({ model: SERVER_DEFAULT_MODEL, ...completionParams })
    } else {
      throw err
    }
  }

  const rawAnswer = completion.choices[0]?.message?.content ?? ''
  const answer = LEARN_MEASUREMENT_CAPABILITIES.responses ? normalizeAssistantCitations(rawAnswer) : rawAnswer
  const provenance = await messageProvenance(event, userId, answer, citationChunks, Boolean(body.history?.length))
  await authorizeContent(Boolean(answer || responseSources.length))
  return {
    answer,
    ...(provenance ? { provenance } : {}),
    model: completion.model,
    usage: completion.usage,
    sources: responseSources,
    ...(modelFallback && { modelFallback }),
  }
})
