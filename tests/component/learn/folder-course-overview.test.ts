import { describe, expect, it, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const course = ref({
  _id: 'course_1',
  title: 'Organic Chemistry',
  completedSectionCount: 0,
  totalSectionCount: 1,
  pace: 'steady',
  status: 'ready',
})
const sections = ref([
  { _id: 'section_1', courseId: 'course_1', title: 'Functional Groups', order: 0, status: 'ready', masteryLevel: 'new' },
])

mockNuxtImport('useRoute', () => {
  return () => ({ params: { id: 'folder_1', courseId: 'course_1' } })
})

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: unknown) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name === 'courses:get') return { data: course }
    if (name === 'courseSections:listByCourse') return { data: sections }
    return { data: ref(null) }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return () => ({ mutate: vi.fn(), isLoading: ref(false) })
})

mockNuxtImport('useConvexAction', () => {
  return () => ({ mutate: vi.fn(), isLoading: ref(false) })
})

vi.mock('~/composables/useFolderPageContext', () => ({
  injectFolderContext: () => ({ folderId: computed(() => 'folder_1') }),
}))

const pagePath = ['~', 'pages', 'app', 'folders', '[id]', 'learn', '[courseId]', 'index.vue'].join('/')

describe('V1 folder Void overview page', () => {
  it('names the folder Voids in the back link', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)

    const back = wrapper.find('a[href="/app/folders/folder_1/learn/"]')
    expect(back.exists()).toBe(true)
    expect(back.text()).toBe('Back to folder Voids')
  })
})
