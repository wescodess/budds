import { ref } from 'vue'
import {
  decryptOfflineBytes,
  decryptOfflineJson,
  encryptOfflineBytes,
  encryptOfflineJson,
  generateOfflineDataKey,
} from '~~/shared/offline-data-encryption'
import type { EncryptedOfflinePayload } from '~~/shared/offline-data-encryption'

const DB_NAME = 'budds-offline'
const DB_VERSION = 3
const SECTION_STORE = 'sections'
const ATTEMPTS_STORE = 'offlineAttempts'
const AUDIO_STORE = 'audio'
const KEY_STORE = 'cryptoKeys'
const LEGACY_AUDIO_CACHE_NAME = 'budds-learn-audio-v1'
const MAX_CACHED_SECTIONS = 20
const PRIMARY_KEY = 'primary'

export interface CachedSection {
  sectionId: string
  courseId: string
  title: string
  contentBlocks: Array<{
    type: 'text' | 'quiz' | 'flashcard' | 'audio'
    entityId?: string
    content?: string
    order: number
    quizData?: {
      questions: Array<{
        question: string
        type: string
        options?: string[]
        correctAnswer: string
        explanation?: string
        order: number
      }>
    }
    flashcardData?: { cards: Array<{ term: string; definition: string }> }
    audioUrls?: string[]
  }>
  cachedAt: number
}

export interface OfflineAttempt {
  id?: number
  type: 'quiz-retake' | 'flashcard-practice' | 'section-review' | 'review-item-rating' | 'review-session-completion'
  sectionId?: string
  courseId?: string
  idempotencyKey?: string
  timestamp: number
  data: {
    practiceScore?: number
    quizCorrect?: number
    quizTotal?: number
    reviewItemId?: string
    quality?: number
    itemsReviewed?: number
    itemsCorrect?: number
    durationMs?: number
    mode?: 'full' | 'quick'
  }
  synced: boolean
  syncAttempts?: number
}

interface EncryptedSectionRecord {
  sectionId: string
  courseId: string
  cachedAt: number
  payload: EncryptedOfflinePayload
}

interface EncryptedAttemptRecord {
  id?: number
  sectionId?: string
  idempotencyKey?: string
  timestamp: number
  synced: boolean
  syncAttempts?: number
  payload: EncryptedOfflinePayload
}

interface EncryptedAudioRecord {
  url: string
  cachedAt: number
  status: number
  statusText: string
  headers: Array<[string, string]>
  payload: EncryptedOfflinePayload
}

let keyPromise: Promise<CryptoKey> | null = null
let migrationPromise: Promise<void> | null = null

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function loadOrCreateKey(db: IDBDatabase): Promise<CryptoKey> {
  const readTx = db.transaction(KEY_STORE, 'readonly')
  const existing = await requestResult(readTx.objectStore(KEY_STORE).get(PRIMARY_KEY)) as
    | { name: string; key: CryptoKey }
    | undefined
  await transactionDone(readTx)
  if (existing?.key) return existing.key

  const key = await generateOfflineDataKey()
  const writeTx = db.transaction(KEY_STORE, 'readwrite')
  writeTx.objectStore(KEY_STORE).put({ name: PRIMARY_KEY, key })
  await transactionDone(writeTx)
  return key
}

async function migrateLegacyRecords(db: IDBDatabase, key: CryptoKey): Promise<void> {
  const readTx = db.transaction([SECTION_STORE, ATTEMPTS_STORE], 'readonly')
  const [sections, attempts] = await Promise.all([
    requestResult(readTx.objectStore(SECTION_STORE).getAll()),
    requestResult(readTx.objectStore(ATTEMPTS_STORE).getAll()),
  ])
  await transactionDone(readTx)

  const legacySections = (sections as Array<CachedSection | EncryptedSectionRecord>)
    .filter((row): row is CachedSection => !('payload' in row))
  const legacyAttempts = (attempts as Array<OfflineAttempt | EncryptedAttemptRecord>)
    .filter((row): row is OfflineAttempt => !('payload' in row))
  if (legacySections.length > 0 || legacyAttempts.length > 0) {
    const encryptedSections = await Promise.all(legacySections.map(async row => ({
      sectionId: row.sectionId,
      courseId: row.courseId,
      cachedAt: row.cachedAt,
      payload: await encryptOfflineJson(row, key),
    })))
    const encryptedAttempts = await Promise.all(legacyAttempts.map(async row => ({
      id: row.id,
      sectionId: row.sectionId,
      idempotencyKey: row.idempotencyKey,
      timestamp: row.timestamp,
      synced: row.synced,
      syncAttempts: row.syncAttempts,
      payload: await encryptOfflineJson(row, key),
    })))
    const writeTx = db.transaction([SECTION_STORE, ATTEMPTS_STORE], 'readwrite')
    for (const row of encryptedSections) writeTx.objectStore(SECTION_STORE).put(row)
    for (const row of encryptedAttempts) writeTx.objectStore(ATTEMPTS_STORE).put(row)
    await transactionDone(writeTx)
  }

  if ('caches' in globalThis) await caches.delete(LEGACY_AUDIO_CACHE_NAME)
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SECTION_STORE)) {
        db.createObjectStore(SECTION_STORE, { keyPath: 'sectionId' })
      }
      const attempts = db.objectStoreNames.contains(ATTEMPTS_STORE)
        ? request.transaction!.objectStore(ATTEMPTS_STORE)
        : db.createObjectStore(ATTEMPTS_STORE, { keyPath: 'id', autoIncrement: true })
      if (!attempts.indexNames.contains('by_synced')) attempts.createIndex('by_synced', 'synced', { unique: false })
      if (!attempts.indexNames.contains('by_sectionId')) attempts.createIndex('by_sectionId', 'sectionId', { unique: false })
      if (!attempts.indexNames.contains('by_idempotencyKey')) {
        attempts.createIndex('by_idempotencyKey', 'idempotencyKey', { unique: false })
      }
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE, { keyPath: 'url' })
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE, { keyPath: 'name' })
    }
    request.onsuccess = async () => {
      const db = request.result
      try {
        keyPromise ??= loadOrCreateKey(db)
        const key = await keyPromise
        migrationPromise ??= migrateLegacyRecords(db, key)
        await migrationPromise
        resolve(db)
      }
      catch (error) {
        db.close()
        reject(error)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

async function offlineKey(): Promise<CryptoKey> {
  if (keyPromise) return await keyPromise
  const db = await openDB()
  db.close()
  return await keyPromise!
}

async function storeSection(data: CachedSection): Promise<void> {
  const payload = await encryptOfflineJson(data, await offlineKey())
  const db = await openDB()
  const tx = db.transaction(SECTION_STORE, 'readwrite')
  const store = tx.objectStore(SECTION_STORE)
  store.put({ sectionId: data.sectionId, courseId: data.courseId, cachedAt: data.cachedAt, payload })
  const all = await requestResult(store.getAll()) as EncryptedSectionRecord[]
  if (all.length > MAX_CACHED_SECTIONS) {
    all.sort((a, b) => a.cachedAt - b.cachedAt)
    for (const entry of all.slice(0, all.length - MAX_CACHED_SECTIONS)) store.delete(entry.sectionId)
  }
  await transactionDone(tx)
  db.close()
}

async function getSection(sectionId: string): Promise<CachedSection | null> {
  const db = await openDB()
  const tx = db.transaction(SECTION_STORE, 'readonly')
  const record = await requestResult(tx.objectStore(SECTION_STORE).get(sectionId)) as EncryptedSectionRecord | undefined
  await transactionDone(tx)
  db.close()
  return record ? await decryptOfflineJson<CachedSection>(record.payload, await offlineKey()) : null
}

async function deleteSection(sectionId: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(SECTION_STORE, 'readwrite')
  tx.objectStore(SECTION_STORE).delete(sectionId)
  await transactionDone(tx)
  db.close()
}

async function cacheAudioUrls(urls: string[]): Promise<void> {
  if (urls.length === 0) return
  const key = await offlineKey()
  const records = await Promise.all(urls.map(async (url): Promise<EncryptedAudioRecord | null> => {
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      return {
        url,
        cachedAt: Date.now(),
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        payload: await encryptOfflineBytes(bytes, key),
      }
    }
    catch {
      return null
    }
  }))
  const db = await openDB()
  const tx = db.transaction(AUDIO_STORE, 'readwrite')
  for (const record of records) if (record) tx.objectStore(AUDIO_STORE).put(record)
  await transactionDone(tx)
  db.close()
}

async function getAudioFromCache(url: string): Promise<Response | undefined> {
  const db = await openDB()
  const tx = db.transaction(AUDIO_STORE, 'readonly')
  const record = await requestResult(tx.objectStore(AUDIO_STORE).get(url)) as EncryptedAudioRecord | undefined
  await transactionDone(tx)
  db.close()
  if (!record) return undefined
  const bytes = await decryptOfflineBytes(record.payload, await offlineKey())
  return new Response(bytes, { status: record.status, statusText: record.statusText, headers: record.headers })
}

export async function addOfflineAttempt(attempt: Omit<OfflineAttempt, 'id' | 'synced'>): Promise<number> {
  const payload = await encryptOfflineJson({ ...attempt, synced: false }, await offlineKey())
  const db = await openDB()
  const tx = db.transaction(ATTEMPTS_STORE, 'readwrite')
  const store = tx.objectStore(ATTEMPTS_STORE)
  if (attempt.idempotencyKey) {
    const existing = await requestResult(store.index('by_idempotencyKey').get(attempt.idempotencyKey)) as
      | EncryptedAttemptRecord
      | undefined
    if (existing?.id !== undefined) {
      await transactionDone(tx)
      db.close()
      return existing.id
    }
  }
  const id = await requestResult(store.add({
    sectionId: attempt.sectionId,
    idempotencyKey: attempt.idempotencyKey,
    timestamp: attempt.timestamp,
    synced: false,
    syncAttempts: attempt.syncAttempts,
    payload,
  })) as number
  await transactionDone(tx)
  db.close()
  return id
}

export async function getUnsyncedAttempts(): Promise<OfflineAttempt[]> {
  const db = await openDB()
  const tx = db.transaction(ATTEMPTS_STORE, 'readonly')
  const records = await requestResult(
    tx.objectStore(ATTEMPTS_STORE).index('by_synced').getAll(IDBKeyRange.only(false)),
  ) as EncryptedAttemptRecord[]
  await transactionDone(tx)
  db.close()
  const key = await offlineKey()
  return await Promise.all(records.map(async record => ({
    ...await decryptOfflineJson<OfflineAttempt>(record.payload, key),
    id: record.id,
    synced: record.synced,
    syncAttempts: record.syncAttempts,
  })))
}

async function patchAttemptMetadata(id: number, patch: Partial<Pick<EncryptedAttemptRecord, 'synced' | 'syncAttempts'>>): Promise<void> {
  const db = await openDB()
  const readTx = db.transaction(ATTEMPTS_STORE, 'readonly')
  const current = await requestResult(readTx.objectStore(ATTEMPTS_STORE).get(id)) as EncryptedAttemptRecord | undefined
  await transactionDone(readTx)
  if (current) {
    const writeTx = db.transaction(ATTEMPTS_STORE, 'readwrite')
    writeTx.objectStore(ATTEMPTS_STORE).put({ ...current, ...patch })
    await transactionDone(writeTx)
  }
  db.close()
}

export async function markAttemptSynced(id: number): Promise<void> {
  await patchAttemptMetadata(id, { synced: true })
}

export async function incrementSyncAttempts(id: number): Promise<void> {
  const db = await openDB()
  const readTx = db.transaction(ATTEMPTS_STORE, 'readonly')
  const current = await requestResult(readTx.objectStore(ATTEMPTS_STORE).get(id)) as EncryptedAttemptRecord | undefined
  await transactionDone(readTx)
  db.close()
  if (current) await patchAttemptMetadata(id, { syncAttempts: (current.syncAttempts ?? 0) + 1 })
}

export async function clearSyncedAttempts(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(ATTEMPTS_STORE, 'readwrite')
  const request = tx.objectStore(ATTEMPTS_STORE).index('by_synced').openCursor(IDBKeyRange.only(true))
  request.onsuccess = () => {
    const cursor = request.result
    if (cursor) {
      cursor.delete()
      cursor.continue()
    }
  }
  await transactionDone(tx)
  db.close()
}

export async function clearOfflineData(): Promise<void> {
  if ('caches' in globalThis) await caches.delete(LEGACY_AUDIO_CACHE_NAME)
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline data cleanup was blocked by another tab'))
  })
  keyPromise = null
  migrationPromise = null
}

export function useOfflineCache() {
  const cacheStatus = ref<Map<string, boolean>>(new Map())

  async function cacheSectionContent(
    sectionId: string,
    courseId: string,
    title: string,
    contentBlocks: CachedSection['contentBlocks'],
    audioUrls: string[],
  ): Promise<void> {
    await storeSection({ sectionId, courseId, title, contentBlocks, cachedAt: Date.now() })
    await cacheAudioUrls(audioUrls)
    cacheStatus.value.set(sectionId, true)
  }

  async function getCachedSection(sectionId: string): Promise<CachedSection | null> {
    return await getSection(sectionId)
  }

  async function checkCacheStatus(sectionIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>()
    if (sectionIds.length === 0) {
      cacheStatus.value = result
      return result
    }
    const db = await openDB()
    const tx = db.transaction(SECTION_STORE, 'readonly')
    const store = tx.objectStore(SECTION_STORE)
    await Promise.all(sectionIds.map(async (id) => {
      const count = await requestResult(store.count(id))
      result.set(id, count > 0)
    }))
    await transactionDone(tx)
    db.close()
    cacheStatus.value = result
    return result
  }

  async function removeCachedSection(sectionId: string): Promise<void> {
    await deleteSection(sectionId)
    cacheStatus.value.set(sectionId, false)
  }

  return {
    cacheStatus,
    cacheSectionContent,
    getCachedSection,
    checkCacheStatus,
    removeCachedSection,
    getAudioFromCache,
  }
}
