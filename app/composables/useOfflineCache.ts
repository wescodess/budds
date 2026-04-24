import { ref } from 'vue'

const DB_NAME = 'budds-offline'
const DB_VERSION = 1
const SECTION_STORE = 'sections'
const AUDIO_CACHE_NAME = 'budds-learn-audio-v1'

interface CachedSection {
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
    flashcardData?: {
      cards: Array<{
        term: string
        definition: string
      }>
    }
    audioUrls?: string[]
  }>
  cachedAt: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SECTION_STORE)) {
        db.createObjectStore(SECTION_STORE, { keyPath: 'sectionId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function storeSection(data: CachedSection): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SECTION_STORE, 'readwrite')
    tx.objectStore(SECTION_STORE).put(data)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function getSection(sectionId: string): Promise<CachedSection | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SECTION_STORE, 'readonly')
    const request = tx.objectStore(SECTION_STORE).get(sectionId)
    request.onsuccess = () => { db.close(); resolve(request.result ?? null) }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

async function isSectionCached(sectionId: string): Promise<boolean> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SECTION_STORE, 'readonly')
    const request = tx.objectStore(SECTION_STORE).count(sectionId)
    request.onsuccess = () => { db.close(); resolve(request.result > 0) }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

async function deleteSection(sectionId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SECTION_STORE, 'readwrite')
    tx.objectStore(SECTION_STORE).delete(sectionId)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function cacheAudioUrls(urls: string[]): Promise<void> {
  if (urls.length === 0) return
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME)
    await Promise.all(urls.map(async (url) => {
      const existing = await cache.match(url)
      if (!existing) {
        const response = await fetch(url)
        if (response.ok) await cache.put(url, response)
      }
    }))
  } catch {
    // Cache API may not be available; non-critical
  }
}

async function getAudioFromCache(url: string): Promise<Response | undefined> {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME)
    return await cache.match(url) || undefined
  } catch {
    return undefined
  }
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
    await storeSection({
      sectionId,
      courseId,
      title,
      contentBlocks,
      cachedAt: Date.now(),
    })

    if (audioUrls.length > 0) {
      await cacheAudioUrls(audioUrls)
    }

    cacheStatus.value.set(sectionId, true)
  }

  async function getCachedSection(sectionId: string): Promise<CachedSection | null> {
    return getSection(sectionId)
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
    await Promise.all(sectionIds.map((id) =>
      new Promise<void>((resolve) => {
        const req = store.count(id)
        req.onsuccess = () => { result.set(id, req.result > 0); resolve() }
        req.onerror = () => { result.set(id, false); resolve() }
      }),
    ))
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

export type { CachedSection }
