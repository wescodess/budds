import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { nextTick } from 'vue'

const currentUser = ref<{ _id: string } | null>({ _id: 'owner_1' })
const folders = ref([{ _id: 'folder_1', name: 'Proofs' }])
const documents = ref([{ _id: 'document_1', folderId: 'folder_1', filename: 'proof.pdf', status: 'success' }])
const documentSubscriptions = vi.fn((_reference: unknown, _args: unknown, callback: (value: typeof documents.value) => void) => {
  callback(documents.value)
  return vi.fn()
})
const resumeCandidates = ref<Array<{ ownerId: string, threadId: string, outcome: string, reason: string, unresolvedPoint: string | null, nextAction: { label: string }, reviewCapability?: string }>>([])
const historyPage = vi.fn(async ({ cursor }: { cursor: string | null }) => cursor
  ? { page: [{ threadId: 'thread_old', outcome: 'Older work', lifecycle: 'ended', updatedAt: 1 }], continueCursor: '', isDone: true }
  : { page: [{ threadId: 'thread_recent', outcome: 'Recent work', lifecycle: 'ready', updatedAt: 2 }], continueCursor: 'next', isDone: false })

mockNuxtImport('useConvexQuery', () => (reference: unknown) => {
  const name = getFunctionName(reference as never)
  if (name?.includes('users:getUser')) return { data: currentUser }
  if (name?.includes('listResumeCandidates')) return { data: resumeCandidates }
  return { data: name?.includes('listDocumentsByFolder') ? documents : folders }
})
mockNuxtImport('useConvex', () => () => ({ query: (_reference: unknown, args: { cursor: string | null }) => historyPage(args), onUpdate: documentSubscriptions }))

const path = ['~', 'components', 'learn-adaptive', 'LearningHome.vue'].join('/')
const ordinaryKey = (owner = 'owner_1') => `budds.learn.adaptive-draft.v1:${owner}`
const pasteKey = (owner = 'owner_1') => `budds.learn.adaptive-paste.v1:${owner}`

describe('need-first LearningHome', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    currentUser.value = { _id: 'owner_1' }
    resumeCandidates.value = []
    historyPage.mockClear()
    documentSubscriptions.mockClear()
  })
  async function mount(props: Record<string, unknown> = {}) {
    const component = await import(path)
    const wrapper = await mountSuspended(component.default, { props })
    await nextTick()
    await nextTick()
    return wrapper
  }

  it('shows the ranked target as Resume and only persisted needs-review work as Worth revisiting', async () => {
    resumeCandidates.value = [
      { ownerId: 'owner_1', threadId: 'thread_primary', outcome: 'Finish a proof', reason: 'unfinished_activity', unresolvedPoint: 'The final step', nextAction: { label: 'Review feedback' } },
      { ownerId: 'owner_1', threadId: 'thread_review', outcome: 'Revisit gravity', reason: 'needs_review', unresolvedPoint: null, nextAction: { label: 'Review capability' }, reviewCapability: 'Explain gravity' },
      { ownerId: 'owner_1', threadId: 'thread_source', outcome: 'Changed source', reason: 'source_recovery', unresolvedPoint: null, nextAction: { label: 'Review source' } },
      { ownerId: 'owner_1', threadId: 'thread_recent', outcome: 'Recent notes', reason: 'recent_thread', unresolvedPoint: null, nextAction: { label: 'Continue' } },
    ]
    const wrapper = await mount()
    expect(wrapper.get('[data-testid="learn-adaptive-primary-resume"]').text()).toContain('Finish a proof')
    expect(wrapper.get('[data-testid="learn-adaptive-primary-resume"]').text()).toContain('The final step')
    expect(wrapper.get('[data-testid="learn-adaptive-worth-revisiting"]').text()).toContain('Revisit gravity')
    expect(wrapper.get('[data-testid="learn-adaptive-worth-revisiting"]').text()).toContain('Explain gravity')
    expect(wrapper.get('[data-testid="learn-adaptive-worth-revisiting"] a').text()).toBe('Review capability in thread')
    expect(wrapper.get('[data-testid="learn-adaptive-worth-revisiting"]').text()).not.toContain('Changed source')
    expect(wrapper.get('[data-testid="learn-adaptive-worth-revisiting"]').text()).not.toContain('Recent notes')
    resumeCandidates.value = resumeCandidates.value.filter(item => item.reason !== 'needs_review')
    await nextTick()
    expect(wrapper.find('[data-testid="learn-adaptive-worth-revisiting"]').exists()).toBe(false)
    resumeCandidates.value = [{ ownerId: 'owner_1', threadId: 'thread_review', outcome: 'Revisit gravity', reason: 'needs_review', unresolvedPoint: null, nextAction: { label: 'Review capability' }, reviewCapability: 'Explain gravity' }]
    await nextTick()
    expect(wrapper.get('[data-testid="learn-adaptive-primary-resume"]').text()).toContain('Worth revisiting')
    expect(wrapper.get('[data-testid="learn-adaptive-primary-resume"]').text()).toContain('Explain gravity needs review')
    expect(wrapper.get('[data-testid="learn-adaptive-primary-resume"] a').text()).toBe('Review capability in thread')
    resumeCandidates.value = [{ ownerId: 'owner_1', threadId: 'thread_review', outcome: 'Finish gravity check', reason: 'unfinished_activity', unresolvedPoint: null, nextAction: { label: 'Finish response' }, reviewCapability: 'Explain gravity' }]
    await nextTick()
    expect(wrapper.get('[data-testid="learn-adaptive-primary-resume"] a').text()).toBe('Continue')
    expect(wrapper.get('[data-testid="learn-adaptive-worth-revisiting"]').text()).toContain('Explain gravity')
  })

  it('loads thread summary history one page at a time and keeps owner changes isolated', async () => {
    const wrapper = await mount()
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-adaptive-thread-history"]').text()).toContain('Recent work'))
    expect(wrapper.text()).not.toContain('Older work')
    await wrapper.get('[data-testid="learn-adaptive-history-more"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-adaptive-thread-history"]').text()).toContain('Older work'))
    expect(wrapper.find('[data-testid="learn-adaptive-history-more"]').exists()).toBe(false)
    currentUser.value = { _id: 'owner_2' }
    await vi.waitFor(() => expect(historyPage.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(wrapper.get('[data-testid="learn-adaptive-thread-history"]').text()).not.toContain('Older work')
  })
  async function fillRequired(wrapper: Awaited<ReturnType<typeof mount>>) {
    await wrapper.get('[data-testid="learn-adaptive-need"]').setValue('Help me understand these notes')
    await wrapper.get('[data-testid="learn-adaptive-outcome"]').setValue('Explain the key idea in my own words')
  }

  it('names the new learning form and labels its goal, outcome, time, and material choices', async () => {
    const wrapper = await mount()
    expect(wrapper.get('form').attributes('aria-label')).toBe('Start a learning thread')
    for (const [selector, label] of [
      ['[data-testid="learn-adaptive-need"]', 'Your goal or question'],
      ['[data-testid="learn-adaptive-outcome"]', 'Useful outcome'],
      ['[data-testid="learn-adaptive-time"]', 'Time available'],
    ]) {
      const field = wrapper.get(selector!).element as HTMLInputElement
      expect(Array.from(field.labels ?? []).map(item => item.textContent).join(' ')).toContain(label)
    }
    expect(wrapper.findAll('fieldset legend').map(legend => legend.text())).toContain('Optional material')
    for (const [value, label] of [['none', 'No material'], ['folder', 'folder'], ['document', 'document'], ['url', 'url'], ['pasted', 'pasted']]) {
      const input = wrapper.get(`input[type="radio"][value="${value}"]`).element as HTMLInputElement
      expect(input.labels?.[0]?.textContent?.trim()).toBe(label)
    }
    wrapper.unmount()
  })

  it('names the Resume, Worth revisiting, and Learning history regions with their visible headings', async () => {
    resumeCandidates.value = [
      { ownerId: 'owner_1', threadId: 'thread_1', outcome: 'Finish the proof', reason: 'unfinished_activity', unresolvedPoint: 'The last step', nextAction: { label: 'Continue' } },
      { ownerId: 'owner_1', threadId: 'thread_2', outcome: 'Review gravity', reason: 'needs_review', unresolvedPoint: null, nextAction: { label: 'Review capability' }, reviewCapability: 'Explain gravity' },
    ]
    const wrapper = await mount()
    for (const [testId, name] of [['learn-adaptive-primary-resume', 'Resume'], ['learn-adaptive-worth-revisiting', 'Worth revisiting'], ['learn-adaptive-thread-history', 'Learning history']]) {
      const region = wrapper.get(`section[data-testid="${testId}"]`)
      const heading = wrapper.get(`#${region.attributes('aria-labelledby')}`)
      expect(heading.text()).toBe(name)
      expect(heading.isVisible()).toBe(true)
    }
    wrapper.unmount()
  })

  it('announces saving a new learning thread until its creation settles', async () => {
    const wrapper = await mount()
    await wrapper.setProps({ busy: true })
    expect(wrapper.findAll('[role="status"][aria-live="polite"]').map(status => status.text())).toContain('Saving your learning thread…')
    expect(wrapper.get('[data-testid="learn-adaptive-start"]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ busy: false, serverError: 'Your thread could not be saved. Try again.' })
    expect(wrapper.findAll('[role="status"][aria-live="polite"]').map(status => status.text())).not.toContain('Saving your learning thread…')
    expect(wrapper.get('[role="alert"]').text()).toBe('Your thread could not be saved. Try again.')
    wrapper.unmount()
  })

  it.each([
    ['folder', [['learn-adaptive-folder', 'Folder']]],
    ['document', [['learn-adaptive-document-folder', 'Folder'], ['learn-adaptive-document', 'Document']]],
    ['url', [['learn-adaptive-url', 'URL']]],
    ['pasted', [['learn-adaptive-paste', 'Pasted material']]],
  ] as const)('labels the additional fields when %s material is selected', async (kind, fields) => {
    const wrapper = await mount()
    await wrapper.get(`input[type="radio"][value="${kind}"]`).setValue()
    for (const [testId, label] of fields) {
      const field = wrapper.get(`[data-testid="${testId}"]`).element as HTMLInputElement
      expect(Array.from(field.labels ?? []).map(item => item.textContent).join(' ')).toContain(label)
    }
    wrapper.unmount()
  })

  it('moves DOM focus to the invalid URL and links its announced correction while preserving the goal', async () => {
    const component = await import(path)
    const wrapper = await mountSuspended(component.default, { attachTo: document.body })
    try {
      await wrapper.get('[data-testid="learn-adaptive-need"]').setValue('Understand the argument in this article')
      await wrapper.get('input[type="radio"][value="url"]').setValue()
      const field = wrapper.get('[data-testid="learn-adaptive-url"]')
      await field.setValue('invalid')
      await wrapper.get('form').trigger('submit')
      expect(document.activeElement).toBe(field.element)
      expect(field.attributes('aria-invalid')).toBe('true')
      expect(document.getElementById(field.attributes('aria-describedby')!)?.textContent).toContain('URL')
      expect((wrapper.get('[data-testid="learn-adaptive-need"]').element as HTMLTextAreaElement).value).toBe('Understand the argument in this article')
    }
    finally { wrapper.unmount() }
  })

  it('does not subscribe to documents without a selected folder', async () => {
    const wrapper = await mount()
    expect(documentSubscriptions).not.toHaveBeenCalled()
    await wrapper.get('input[type="radio"][value="document"]').setValue()
    expect(documentSubscriptions).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="learn-adaptive-document-folder"]').setValue('folder_1')
    await vi.waitFor(() => expect(documentSubscriptions).toHaveBeenCalledTimes(1))
  })

  it('presents the ranked resume target and its unresolved point before the new goal form', async () => {
    resumeCandidates.value = [{ ownerId: 'owner_1', threadId: 'thread_1', outcome: 'Explain orbital motion', reason: 'unfinished_activity', unresolvedPoint: 'Why does the orbit curve?', nextAction: { label: 'Explain the orbit' } }]
    const wrapper = await mount()
    const list = wrapper.get('[data-testid="learn-adaptive-primary-resume"]')
    expect(list.text()).toContain('Unfinished activity')
    expect(list.text()).toContain('Why does the orbit curve?')
    expect(list.get('a').attributes('href')).toBe('/app/learn/thread/thread_1')
    await list.get('a').trigger('click')
    expect(wrapper.emitted('resume')?.[0]).toEqual(['thread_1'])
    expect(wrapper.element.querySelector('[data-testid="learn-adaptive-primary-resume"]')?.compareDocumentPosition(wrapper.element.querySelector('form')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    currentUser.value = { _id: 'owner_2' }
    await nextTick()
    expect(wrapper.find('[data-testid="learn-adaptive-primary-resume"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('saves a single selected intent chip in the owner draft and submits that intent', async () => {
    const wrapper = await mount()
    await fillRequired(wrapper)
    await wrapper.get('[data-testid="learn-intent-chip-master"]').trigger('click')
    expect(wrapper.findAll('[aria-pressed="true"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="learn-intent-chip-master"]').attributes('aria-pressed')).toBe('true')
    await vi.waitFor(() => expect(sessionStorage.getItem(ordinaryKey())).toContain('"intent":"master"'))
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('start')?.[0]?.[0]).toMatchObject({ intent: 'master' })
  })

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
