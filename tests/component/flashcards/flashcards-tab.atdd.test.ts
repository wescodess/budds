import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

// ATDD (failing-first) for Story 7.1 — Generate Flash Cards from Folder Documents.
// Mirrors the 6-1 Quiz tab ATDD pattern: red tests authored pre-implementation,
// driving Task 6 (composable + FlashcardsTab.vue) and Task 7 (component test).
//
// Epic 6 retro Team Agreement — "No new portaled primitives in mountSuspended-tested
// components" is a standing V1.x rule. The four assertions below all run against the
// tab's non-portal surface (empty states, generate button, list cards). If dev needs
// to introduce a Reka portal inside the tab body, BLOCKED per the scope-overflow rule
// — do NOT silently expand.

const mockHasIndexedDocuments = ref(false)
const mockSets = ref<any[]>([])
const mockGenerating = ref(false)
const mockLastError = ref<string | null>(null)
const mockGenerate = vi.fn()

mockNuxtImport('useFlashcards', () => {
  return () => ({
    sets: mockSets,
    hasIndexedDocuments: mockHasIndexedDocuments,
    generating: mockGenerating,
    lastError: mockLastError,
    generate: mockGenerate,
  })
})

const flashcardsTabPath = ['~', 'components', 'flashcards', 'Tab.vue'].join('/')

describe('FlashcardsTab — Story 7.1 AC #5, #6, #7 (ATDD red-first)', () => {
  beforeEach(() => {
    mockHasIndexedDocuments.value = false
    mockSets.value = []
    mockGenerating.value = false
    mockLastError.value = null
    mockGenerate.mockReset()
  })

  it('[P0] renders empty-no-docs state when no indexed documents exist', async () => {
    const FlashcardsTab = await import(flashcardsTabPath)
    mockHasIndexedDocuments.value = false
    mockSets.value = []

    const wrapper = await mountSuspended(FlashcardsTab.default, {
      props: { folderId: 'folder_abc' },
    })

    expect(wrapper.find('[data-testid="flashcards-empty-no-docs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcards-generate-button"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Upload and index documents to generate flash cards')
  })

  it('[P0] renders empty-ready state with Generate button when docs exist but no sets', async () => {
    const FlashcardsTab = await import(flashcardsTabPath)
    mockHasIndexedDocuments.value = true
    mockSets.value = []

    const wrapper = await mountSuspended(FlashcardsTab.default, {
      props: { folderId: 'folder_abc' },
    })

    expect(wrapper.find('[data-testid="flashcards-empty-ready"]').exists()).toBe(true)
    const generateBtn = wrapper.find('[data-testid="flashcards-generate-button"]')
    expect(generateBtn.exists()).toBe(true)
    expect(wrapper.text()).toContain('No flash card sets yet')
  })

  it('[P0] clicking Generate invokes the useFlashcards.generate() call', async () => {
    const FlashcardsTab = await import(flashcardsTabPath)
    mockHasIndexedDocuments.value = true
    mockSets.value = []
    mockGenerate.mockResolvedValue(undefined)

    const wrapper = await mountSuspended(FlashcardsTab.default, {
      props: { folderId: 'folder_abc' },
    })

    await wrapper.find('[data-testid="flashcards-generate-button"]').trigger('click')
    await flushPromises()

    expect(mockGenerate).toHaveBeenCalledTimes(1)
  })

  it('[P0] renders one card per set when sets are present', async () => {
    const FlashcardsTab = await import(flashcardsTabPath)
    mockHasIndexedDocuments.value = true
    mockSets.value = [
      {
        _id: 'set_1',
        _creationTime: Date.now(),
        title: 'Cell Biology Flashcards',
        status: 'ready',
        cardCount: 12,
      },
      {
        _id: 'set_2',
        _creationTime: Date.now() - 1000,
        title: 'Photosynthesis Deck',
        status: 'ready',
        cardCount: 8,
      },
    ]

    const wrapper = await mountSuspended(FlashcardsTab.default, {
      props: { folderId: 'folder_abc' },
    })

    const cards = wrapper.findAll('[data-testid="flashcards-set-card"]')
    expect(cards).toHaveLength(2)
    expect(wrapper.text()).toContain('Cell Biology Flashcards')
    expect(wrapper.text()).toContain('Photosynthesis Deck')
    expect(wrapper.text()).toContain('12 cards')
    expect(wrapper.text()).toContain('8 cards')
  })

  it('[P1] shows shimmer placeholders while generating', async () => {
    const FlashcardsTab = await import(flashcardsTabPath)
    mockHasIndexedDocuments.value = true
    mockSets.value = []
    mockGenerating.value = true

    const wrapper = await mountSuspended(FlashcardsTab.default, {
      props: { folderId: 'folder_abc' },
    })

    expect(wrapper.find('[data-testid="flashcards-shimmer"]').exists()).toBe(true)
  })
})
