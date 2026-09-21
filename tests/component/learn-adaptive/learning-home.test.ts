import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { nextTick } from 'vue'

const currentUser = ref<{ _id: string } | null>({ _id: 'owner_1' })
const folders = ref([{ _id: 'folder_1', name: 'Proofs' }])
const documents = ref([{ _id: 'document_1', folderId: 'folder_1', filename: 'proof.pdf', status: 'success' }])

mockNuxtImport('useConvexQuery', () => (reference: unknown) => {
  const name = getFunctionName(reference as never)
  if (name?.includes('users:getUser')) return { data: currentUser }
  return { data: name?.includes('listDocumentsByFolder') ? documents : folders }
})

const path = ['~', 'components', 'learn-adaptive', 'LearningHome.vue'].join('/')
const ordinaryKey = (owner = 'owner_1') => `budds.learn.adaptive-draft.v1:${owner}`
const pasteKey = (owner = 'owner_1') => `budds.learn.adaptive-paste.v1:${owner}`

describe('need-first LearningHome', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    currentUser.value = { _id: 'owner_1' }
  })
  async function mount(props: Record<string, unknown> = {}) {
    const component = await import(path)
    const wrapper = await mountSuspended(component.default, { props })
    await nextTick()
    await nextTick()
    return wrapper
  }
  async function fillRequired(wrapper: Awaited<ReturnType<typeof mount>>) {
    await wrapper.get('[data-testid="learn-adaptive-need"]').setValue('Help me understand these notes')
    await wrapper.get('[data-testid="learn-adaptive-outcome"]').setValue('Explain the key idea in my own words')
  }

  it('keeps entered content, associates the correction, and focuses the first invalid field', async () => {
    const wrapper = await mount()
    const need = wrapper.get('[data-testid="learn-adaptive-need"]')
    const focus = vi.spyOn(need.element as HTMLTextAreaElement, 'focus')
    await need.setValue('short')
    await wrapper.get('form').trigger('submit')
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('8 meaningful')
    expect((need.element as HTMLTextAreaElement).value).toBe('short')
    expect(need.attributes('aria-describedby')).toBe(alert.attributes('id'))
    expect(focus).toHaveBeenCalledOnce()
    expect(wrapper.emitted('start')).toBeUndefined()
  })

  it('emits exactly one selected source and stores raw paste only in the owner session', async () => {
    const wrapper = await mount()
    const rawPaste = 'Private learner notes that stay in this browser session.'
    await fillRequired(wrapper)
    await wrapper.find('input[value="pasted"]').setValue()
    await wrapper.get('[data-testid="learn-adaptive-paste"]').setValue(rawPaste)
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.emitted('start')).toHaveLength(1))
    const payload = wrapper.emitted('start')![0]![0] as Record<string, any>
    expect(payload).toMatchObject({ clientDraftId: expect.stringMatching(/^[A-Za-z0-9._~-]+$/), need: 'Help me understand these notes', outcome: 'Explain the key idea in my own words', sourceScope: { kind: 'pasted', contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), byteCount: new TextEncoder().encode(rawPaste).byteLength } })
    expect(JSON.stringify(payload)).not.toContain(rawPaste)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.getItem(ordinaryKey())).not.toContain(rawPaste)
    expect(sessionStorage.getItem(pasteKey())).toContain(rawPaste)
    expect(Object.keys(payload.sourceScope)).toEqual(['kind', 'contentDigest', 'byteCount'])
  })

  it('creates from a goal alone and associates source and UTF-8 errors only with the failing field', async () => {
    const wrapper = await mount()
    const need = wrapper.get('[data-testid="learn-adaptive-need"]')
    await need.setValue('A sufficient goal without a separate outcome')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.emitted('start')).toHaveLength(1))
    expect(wrapper.emitted('start')![0]![0]).not.toHaveProperty('outcome')

    await wrapper.find('input[value="folder"]').setValue()
    await wrapper.get('form').trigger('submit')
    const folder = wrapper.get('[data-testid="learn-adaptive-folder"]')
    expect(folder.attributes('aria-invalid')).toBe('true')
    expect(folder.attributes('aria-describedby')).toBe(wrapper.get('[role="alert"]').attributes('id'))
    expect(need.attributes('aria-invalid')).toBeUndefined()

    await wrapper.find('input[value="none"]').setValue()
    const focus = vi.spyOn(need.element as HTMLTextAreaElement, 'focus')
    await need.setValue('💥'.repeat(3_000))
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('8 KB')
    expect(need.attributes('aria-invalid')).toBe('true')
    expect(focus).toHaveBeenCalled()
  })

  it('clears ordinary state only after ACK, retains paste across remount, and persists a later draft', async () => {
    let wrapper = await mount({ serverError: 'Temporary failure' })
    await fillRequired(wrapper)
    await wrapper.find('input[value="pasted"]').setValue()
    await wrapper.get('[data-testid="learn-adaptive-paste"]').setValue('Paste remains until import or discard.')
    await vi.waitFor(() => expect(sessionStorage.getItem(ordinaryKey())).toContain('understand these notes'))
    expect(wrapper.get('[role="alert"]').text()).toContain('Temporary failure')
    await wrapper.setProps({ acknowledgedRequestKey: 'need-draft-acknowledged' })
    await vi.waitFor(() => expect((wrapper.get('[data-testid="learn-adaptive-need"]').element as HTMLTextAreaElement).value).toBe(''))
    expect(sessionStorage.getItem(pasteKey())).toContain('Paste remains')
    wrapper.unmount()

    wrapper = await mount()
    await wrapper.find('input[value="pasted"]').setValue()
    expect((wrapper.get('[data-testid="learn-adaptive-paste"]').element as HTMLTextAreaElement).value).toContain('Paste remains')
    await wrapper.get('[data-testid="learn-adaptive-discard-paste"]').trigger('click')
    expect(sessionStorage.getItem(pasteKey())).toBeNull()
    await wrapper.find('input[value="none"]').setValue()
    await wrapper.get('[data-testid="learn-adaptive-need"]').setValue('A second ordinary draft after success')
    await wrapper.get('[data-testid="learn-adaptive-outcome"]').setValue('Retain this second desired outcome')
    await vi.waitFor(() => expect(sessionStorage.getItem(ordinaryKey())).toContain('second ordinary draft'))
  })

  it('partitions session drafts by signed-in owner and expires stale records', async () => {
    const wrapper = await mount()
    await wrapper.get('[data-testid="learn-adaptive-need"]').setValue('Owner one private draft wording')
    await vi.waitFor(() => expect(sessionStorage.getItem(ordinaryKey('owner_1'))).toContain('Owner one'))
    currentUser.value = { _id: 'owner_2' }
    await nextTick()
    await vi.waitFor(() => expect((wrapper.get('[data-testid="learn-adaptive-need"]').element as HTMLTextAreaElement).value).toBe(''))
    expect(sessionStorage.getItem(ordinaryKey('owner_2')) ?? '').not.toContain('Owner one')
    currentUser.value = { _id: 'owner_1' }
    await vi.waitFor(() => expect((wrapper.get('[data-testid="learn-adaptive-need"]').element as HTMLTextAreaElement).value).toContain('Owner one'))
    sessionStorage.setItem(ordinaryKey('owner_3'), JSON.stringify({ savedAt: 0, value: { need: 'Expired secret' } }))
    currentUser.value = { _id: 'owner_3' }
    await vi.waitFor(() => expect((wrapper.get('[data-testid="learn-adaptive-need"]').element as HTMLTextAreaElement).value).toBe(''))
    expect(sessionStorage.getItem(ordinaryKey('owner_3')) ?? '').not.toContain('Expired secret')
  })

  it('preserves input entered while owner identity is loading, then scopes it after resolution', async () => {
    currentUser.value = null
    const wrapper = await mount()
    await wrapper.get('[data-testid="learn-adaptive-need"]').setValue('Do not lose this pending learner need')
    expect(wrapper.get('[data-testid="learn-adaptive-start"]').attributes('disabled')).toBeDefined()
    currentUser.value = { _id: 'owner_1' }
    await vi.waitFor(() => expect(sessionStorage.getItem(ordinaryKey())).toContain('pending learner need'))
    expect((wrapper.get('[data-testid="learn-adaptive-need"]').element as HTMLTextAreaElement).value).toContain('pending learner need')
  })

  it('rejects oversized UTF-8 paste before invoking WebCrypto and exposes 44px source targets', async () => {
    const wrapper = await mount()
    await fillRequired(wrapper)
    await wrapper.find('input[value="pasted"]').setValue()
    const digest = vi.spyOn(crypto.subtle, 'digest')
    const paste = wrapper.get('[data-testid="learn-adaptive-paste"]')
    const focus = vi.spyOn(paste.element as HTMLTextAreaElement, 'focus')
    await paste.setValue('💥'.repeat(20_000))
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('64 KB')
    expect(digest).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledOnce()
    expect(wrapper.find('input[value="none"]').element.parentElement?.className).toContain('min-h-11')
    digest.mockRestore()
  })
})
