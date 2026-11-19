import { signMessageProvenance, type MessageScopeReference } from '../../shared/learn-v2-message-provenance'
import type { AISearchChunk } from './ai-search'
import type { Id } from '../../convex/_generated/dataModel'
import type { H3Event } from 'h3'
import { readConfiguredRuntimeValue } from './runtime-config'

export async function messageProvenance(event: H3Event, userId: string, content: string, chunks: AISearchChunk[], hasHistory: boolean) {
  if (hasHistory || chunks.some(chunk => !chunk.attributes.documentId || !chunk.attributes.folderId)) return
  const references = new Map<string, MessageScopeReference>()
  for (const chunk of chunks) {
    const document: MessageScopeReference = { kind: 'document', id: chunk.attributes.documentId as Id<'documents'> }
    const folder: MessageScopeReference = { kind: 'folder', id: chunk.attributes.folderId as Id<'folders'> }
    references.set(`document:${document.id}`, document)
    references.set(`folder:${folder.id}`, folder)
  }
  const secret = readConfiguredRuntimeValue(useRuntimeConfig(event).betterAuthSecret, 'NUXT_BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET')
  return await signMessageProvenance(secret, userId, content,
    chunks.map(chunk => ({ content: chunk.content, score: chunk.score, filename: chunk.attributes.filename ?? 'Unknown' })), [...references.values()])
}

export class StreamMessageContent {
  private decoder = new TextDecoder()
  private buffer = ''
  private content = ''
  private bytes = 0
  private chunks = 0
  private known = true
  append(chunk: Uint8Array) {
    this.bytes += chunk.byteLength
    if (this.bytes > 512_000 || ++this.chunks > 2048) throw createError({ statusCode: 502, message: 'Help stream unavailable' })
    const lines = (this.buffer + this.decoder.decode(chunk, { stream: true })).split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const value = JSON.parse(data).choices?.[0]?.delta?.content
        if (typeof value === 'string') this.content += value
      } catch { this.known = false }
    }
  }
  value() { return this.known && !this.buffer.trim() ? this.content : null }
}
