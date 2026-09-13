import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockCompleteSection = vi.fn()
const mockSetOfflineAvailable = vi.fn()
const mockCacheSectionContent = vi.fn()
const mockFetch = vi.fn()

const course = ref({
  _id: 'course_1',
  title: 'Legacy Course',
  totalSectionCount: 1,
})
const section = ref({
  _id: 'section_1',
  courseId: 'course_1',
  title: 'Legacy Section',
  order: 0,
  status: 'ready',
  masteryLevel: 'new',
  contentBlocks: [],
})
const sections = ref([section.value])

vi.stubGlobal('$fetch', mockFetch)

mockNuxtImport('useRoute', () => {
  return () => ({
    params: { courseId: 'course_1', sectionId: 'section_1' },
  })
})

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: unknown) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name === 'courses:get') return { data: course }
    if (name === 'courseSections:get') return { data: section }
    if (name === 'courseSections:listByCourse') return { data: sections }
    return { data: ref(null) }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return (apiRef: unknown) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name === 'courseSections:completeSection') {
      return { mutate: mockCompleteSection, isLoading: ref(false) }
    }
    if (name === 'courseSections:setOfflineAvailable') {
      return { mutate: mockSetOfflineAvailable, isLoading: ref(false) }
    }
    return { mutate: vi.fn(), isLoading: ref(false) }
  }
})

mockNuxtImport('useOnlineStatus', () => {
  return () => ({ isOnline: ref(true) })
})

mockNuxtImport('useOfflineCache', () => {
  return () => ({
    cacheSectionContent: mockCacheSectionContent,
    getCachedSection: vi.fn(),
  })
})

mockNuxtImport('useOfflineSync', () => {
  return () => ({ isSyncing: ref(false), pendingCount: ref(0) })
})

mockNuxtImport('usePreFetchSection', () => {
  return () => ({ nextSectionReady: ref(false), isPreFetching: ref(false) })
})

vi.mock('~/composables/useFolderPageContext', () => ({
  injectFolderContext: () => ({ folderId: computed(() => 'folder_1') }),
}))

const pagePath = [
  '~',
  'pages',
  'app',
  'folders',
  '[id]',
  'learn',
  '[courseId]',
  '[sectionId].vue',
].join('/')

describe('legacy section page completion', () => {
  beforeEach(() => {
    mockCompleteSection.mockReset()
    mockCompleteSection.mockResolvedValue({
      practiceScore: 100,
      masteryLevel: 'learning',
      conceptsForReview: 0,
      feedbackText: '',
    })
    mockSetOfflineAvailable.mockReset()
    mockCacheSectionContent.mockReset()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(null)
  })

  it('characterizes V1 submitting a perfect score when no quiz was completed', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      global: {
        stubs: {
          LearnSectionVoidTopBar: true,
          LearnSectionBlockRenderer: true,
          LearnSectionCompletionCard: true,
        },
      },
    })

    await wrapper.find('[data-testid="complete-section-button"]').trigger('click')

    await vi.waitFor(() => {
      expect(mockCompleteSection).toHaveBeenCalledWith({
        sectionId: 'section_1',
        practiceScore: 100,
        quizCorrect: 0,
        quizTotal: 0,
      })
    })
  })
})
