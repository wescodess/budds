import { beforeEach, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const save = vi.fn()
const remove = vi.fn()
const artifacts = ref<Array<{ id: string, activityId: string, artifactKind: 'plan', title: string, summary: string, status: 'draft' | 'saved', readOnly: boolean, historical: boolean, evidenceLabel: null }> | null>([])
const artifactPending = ref(false)
const isOnline = ref(true)
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexQuery', () => (reference: never) => ({ data: getFunctionName(reference)?.includes('listThreadArtifacts') ? artifacts : ref(null), pending: getFunctionName(reference)?.includes('listThreadArtifacts') ? artifactPending : ref(false) }))
mockNuxtImport('useConvexMutation', () => (reference: never) => ({ mutate: getFunctionName(reference)?.includes('deleteArtifact') ? remove : save }))

const canvas = {
  ownerId: 'owner_1', status: 'eligible', thread: { id: 'thread_1', revision: 3, outcome: 'Build a study plan' },
  activity: { id: 'artifact_1', planRevision: 1, status: 'eligible',
    primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'artifact_workspace', action: 'save_artifact', testId: 'learn-primitive-artifact-workspace', props: { prompt: 'Build a concise plan.', artifactKind: 'plan', starterText: 'Goal:' } },
    fallback: { title: 'Activity unavailable', body: 'Try later.', testId: 'learn-activity-fallback', primaryAction: { label: 'Continue safely' } } },
}

beforeEach(() => { save.mockReset().mockResolvedValue({ kind: 'ok', revision: 4, value: { artifactId: 'artifact_new' } }); remove.mockReset(); artifacts.value = []; artifactPending.value = false; sessionStorage.clear(); isOnline.value = true })

it('mounts artifact ready, completed, mobile, and version fallback fixtures with accessible status', async () => {
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const ready = await mountSuspended(Component.default, { props: { canvas }, attachTo: document.body })
  expect(ready.get('[data-testid="learn-artifact-canvas"]').attributes('aria-label')).toBe('Artifact workspace')
  expect(ready.get('[data-testid="learn-primitive-artifact-workspace"] h2').text()).toBe('Build a useful artifact')
  expect(ready.get('[data-testid="learn-primitive-artifact-workspace"] [role="status"]').text()).toContain('Ready to create')
  ready.unmount()

  artifacts.value = [{ id: 'artifact_saved', activityId: 'artifact_1', artifactKind: 'plan', title: 'My plan', summary: 'Review daily.', status: 'saved', readOnly: false, historical: false, evidenceLabel: null }]
  const completed = await mountSuspended(Component.default, { props: { canvas }, attachTo: document.body })
  expect(completed.get('[data-testid="learn-artifact-saved-status"]').attributes('role')).toBe('status')
  expect(completed.get('[data-testid="learn-artifact-saved-status"]').text()).toContain('Saved artifact')
  completed.unmount()

  artifacts.value = []
  const mobile = await mountSuspended(Component.default, { props: { canvas }, attachTo: document.body })
  expect(mobile.get('[data-testid="learn-artifact-canvas"]').classes()).toContain('min-w-0')
  expect(mobile.get('[data-testid="learn-artifact-save"]').classes()).toContain('min-h-11')
  mobile.unmount()

  const fallback = await mountSuspended(Component.default, { props: { canvas: { ...canvas,
    activity: { ...canvas.activity, primitive: { ...canvas.activity.primitive, rendererVersion: 'learn-adaptive.renderer.v2' } } } }, attachTo: document.body })
  expect(fallback.get('[data-testid="learn-activity-fallback"]').attributes('role')).toBe('alert')
  expect(fallback.find('[data-testid="learn-artifact-save"]').exists()).toBe(false)
  fallback.unmount()
})

it('shows a bounded artifact workspace and saves without scoring', async () => {
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  expect(wrapper.get('[data-testid="learn-primitive-artifact-workspace"]').text()).toContain('does not score')
  expect((wrapper.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).value).toBe('Goal:')
  await wrapper.get('[data-testid="learn-artifact-title"]').setValue('My study plan')
  await wrapper.get('[data-testid="learn-artifact-content"]').setValue('Review the mechanism daily.')
  await wrapper.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ activityId: 'artifact_1', artifactKind: 'plan', title: 'My study plan', summary: 'Review the mechanism daily.', status: 'saved', expectedRevision: 3 })))
  expect(wrapper.text()).toContain('not a mastery result')
  await vi.waitFor(() => expect(sessionStorage.getItem('learn-artifact:owner_1:thread_1:artifact_1:plan:1')).toBeNull())
  wrapper.unmount()
})

it('keeps a local draft after an unconfirmed save and falls back for unsupported actions', async () => {
  save.mockRejectedValueOnce(new Error('timeout'))
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  await wrapper.get('[data-testid="learn-artifact-title"]').setValue('My plan')
  await wrapper.get('[data-testid="learn-artifact-content"]').setValue('Try this tomorrow.')
  await wrapper.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('unconfirmed'))
  wrapper.unmount()
  const restored = await mountSuspended(Component.default, { props: { canvas } })
  expect((restored.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).value).toBe('Try this tomorrow.')
  await restored.setProps({ canvas: { ...canvas, activity: { ...canvas.activity, primitive: { ...canvas.activity.primitive, action: 'share_artifact' } } } })
  expect(restored.get('[data-testid="learn-activity-fallback"]').text()).toContain('action is not supported')
  restored.unmount()
})

it('shows historical artifacts as read-only with a textual state', async () => {
  artifacts.value = [{ id: 'artifact_saved', activityId: 'artifact_1', artifactKind: 'plan', title: 'Earlier plan', summary: 'Saved copy.', status: 'saved', readOnly: true, historical: true, evidenceLabel: null }]
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  expect(wrapper.get('[data-testid="learn-artifact-saved-status"]').text()).toContain('read-only')
  expect((wrapper.get('[data-testid="learn-artifact-save"]').element as HTMLButtonElement).disabled).toBe(true)
  wrapper.unmount()
})

it('shows saved completion and keeps actions usable in a narrow viewport', async () => {
  artifacts.value = [{ id: 'artifact_saved', activityId: 'artifact_1', artifactKind: 'plan', title: 'Tomorrow', summary: 'Practice one example.', status: 'saved', readOnly: false, historical: false, evidenceLabel: null }]
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas }, attachTo: document.body })
  expect(wrapper.get('[data-testid="learn-artifact-saved-status"]').text()).toContain('Saved artifact')
  expect(wrapper.get('[data-testid="learn-artifact-saved-status"]').text()).not.toContain('mastery')
  expect(wrapper.get('[data-testid="learn-artifact-save"]').classes()).toContain('min-h-11')
  expect(wrapper.get('[data-testid="learn-artifact-save"]').element).toBeInstanceOf(HTMLButtonElement)
  wrapper.unmount()
})

it('keeps in-memory edits when the server row arrives and storage is unavailable', async () => {
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable') })
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
  try {
    const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
    const wrapper = await mountSuspended(Component.default, { props: { canvas } })
    const field = wrapper.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement
    field.value = 'My unsaved plan.'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    artifacts.value = [{ id: 'artifact_saved', activityId: 'artifact_1', artifactKind: 'plan', title: 'Server title', summary: 'Older server plan.', status: 'saved', readOnly: false, historical: false, evidenceLabel: null }]
    await nextTick()
    expect((wrapper.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).value).toBe('My unsaved plan.')
    expect(wrapper.get('[data-testid="learn-artifact-saved-status"]').text()).toContain('unsaved edits')
    wrapper.unmount()
  }
  finally { getItem.mockRestore(); setItem.mockRestore() }
})

it('adopts a newer server row only when the editor has no unsaved changes', async () => {
  artifacts.value = [{ id: 'artifact_saved', activityId: 'artifact_1', artifactKind: 'plan', title: 'First title', summary: 'First copy.', status: 'saved', readOnly: false, historical: false, evidenceLabel: null }]
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  artifacts.value = [{ ...artifacts.value[0]!, title: 'Second title', summary: 'Second copy.' }]
  await nextTick()
  expect((wrapper.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).value).toBe('Second copy.')
  await wrapper.get('[data-testid="learn-artifact-content"]').setValue('My unsaved copy.')
  artifacts.value = [{ ...artifacts.value[0]!, title: 'Third title', summary: 'Third copy.' }]
  await nextTick()
  expect((wrapper.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).value).toBe('My unsaved copy.')
  wrapper.unmount()
})

it('uses a new save key after a definite conflict and keeps the draft', async () => {
  save.mockResolvedValueOnce({ kind: 'conflict', code: 'stale_revision' }).mockResolvedValueOnce({ kind: 'ok', revision: 5, value: { artifactId: 'artifact_new' } })
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  await wrapper.get('[data-testid="learn-artifact-title"]').setValue('Plan')
  await wrapper.get('[data-testid="learn-artifact-content"]').setValue('My revised plan.')
  await wrapper.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('changed'))
  await wrapper.setProps({ authoritativeRevision: 4 })
  await wrapper.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[1]![0].expectedRevision).toBe(4)
  expect(save.mock.calls[1]![0].idempotencyKey).not.toBe(save.mock.calls[0]![0].idempotencyKey)
  expect(save.mock.calls[1]![0].summary).toBe('My revised plan.')
  wrapper.unmount()
})

it('uses a new delete key after a definite conflict', async () => {
  artifacts.value = [{ id: 'artifact_saved', activityId: 'artifact_1', artifactKind: 'plan', title: 'Plan', summary: 'Saved.', status: 'saved', readOnly: false, historical: false, evidenceLabel: null }]
  remove.mockResolvedValueOnce({ kind: 'conflict', code: 'stale_revision' }).mockResolvedValueOnce({ kind: 'ok', revision: 5, value: { cleanupPending: false } })
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  await wrapper.get('[data-testid="learn-artifact-delete"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('could not be deleted'))
  await wrapper.setProps({ authoritativeRevision: 4 })
  await wrapper.get('[data-testid="learn-artifact-delete"]').trigger('click')
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
  expect(remove.mock.calls[1]![0].expectedRevision).toBe(4)
  expect(remove.mock.calls[1]![0].idempotencyKey).not.toBe(remove.mock.calls[0]![0].idempotencyKey)
  wrapper.unmount()
})

it('reuses the save key after an unknown outcome to reconcile the same snapshot', async () => {
  save.mockRejectedValueOnce(new Error('network timeout')).mockResolvedValueOnce({ kind: 'ok', revision: 4, value: { artifactId: 'artifact_new' } })
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  await wrapper.get('[data-testid="learn-artifact-title"]').setValue('Plan')
  await wrapper.get('[data-testid="learn-artifact-content"]').setValue('Keep this response.')
  await wrapper.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('unconfirmed'))
  expect((wrapper.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).disabled).toBe(true)
  expect((wrapper.get('[data-testid="learn-artifact-save-draft"]').element as HTMLButtonElement).disabled).toBe(true)
  await wrapper.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[1]![0].idempotencyKey).toBe(save.mock.calls[0]![0].idempotencyKey)
  expect(save.mock.calls[1]![0].expectedRevision).toBe(save.mock.calls[0]![0].expectedRevision)
  expect(save.mock.calls[1]![0].summary).toBe('Keep this response.')
  wrapper.unmount()
})

it('keeps the submitted snapshot and local draft while a save is pending', async () => {
  let resolveSave!: (value: { kind: string, revision: number }) => void
  save.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  await wrapper.get('[data-testid="learn-artifact-title"]').setValue('Plan')
  await wrapper.get('[data-testid="learn-artifact-content"]').setValue('Submitted snapshot.')
  await wrapper.get('[data-testid="learn-artifact-save"]').trigger('click')
  expect((wrapper.get('[data-testid="learn-artifact-title"]').element as HTMLInputElement).disabled).toBe(true)
  expect((wrapper.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).disabled).toBe(true)
  artifacts.value = [{ id: 'artifact_saved', activityId: 'artifact_1', artifactKind: 'plan', title: 'Server copy', summary: 'Older copy.', status: 'saved', readOnly: false, historical: false, evidenceLabel: null }]
  await nextTick()
  expect((wrapper.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).value).toBe('Submitted snapshot.')
  resolveSave({ kind: 'blocked', revision: 3 })
  await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('could not be saved'))
  expect((wrapper.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).value).toBe('Submitted snapshot.')
  expect(wrapper.get('[data-testid="learn-artifact-saved-status"]').text()).toContain('unsaved edits')
  wrapper.unmount()
})

it('edits the returned artifact ID before the list query refreshes', async () => {
  save.mockResolvedValueOnce({ kind: 'ok', revision: 4, value: { artifactId: 'artifact_new' } })
    .mockResolvedValueOnce({ kind: 'ok', revision: 5, value: { artifactId: 'artifact_new' } })
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  await wrapper.get('[data-testid="learn-artifact-title"]').setValue('Plan')
  await wrapper.get('[data-testid="learn-artifact-content"]').setValue('First copy.')
  await wrapper.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Artifact saved.'))
  await wrapper.get('[data-testid="learn-artifact-content"]').setValue('Second copy.')
  await wrapper.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[0]![0].artifactId).toBeUndefined()
  expect(save.mock.calls[1]![0]).toMatchObject({ artifactId: 'artifact_new', expectedRevision: 4, summary: 'Second copy.' })
  wrapper.unmount()
})

it('replays an uncertain create after remount with the original command key and snapshot', async () => {
  save.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ kind: 'ok', revision: 4, value: { artifactId: 'artifact_new' } })
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const first = await mountSuspended(Component.default, { props: { canvas } })
  await first.get('[data-testid="learn-artifact-title"]').setValue('My plan')
  await first.get('[data-testid="learn-artifact-content"]').setValue('Keep one useful plan.')
  await first.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(first.get('[role="alert"]').text()).toContain('unconfirmed'))
  first.unmount()
  const restored = await mountSuspended(Component.default, { props: { canvas } })
  expect((restored.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).disabled).toBe(true)
  await restored.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[1]![0]).toMatchObject({ title: 'My plan', summary: 'Keep one useful plan.', status: 'saved', expectedRevision: 3, idempotencyKey: save.mock.calls[0]![0].idempotencyKey })
  expect(save.mock.calls[1]![0].artifactId).toBeUndefined()
  restored.unmount()
})

it('retains a confirmed artifact ID across remount until the list catches up', async () => {
  save.mockResolvedValueOnce({ kind: 'ok', revision: 4, value: { artifactId: 'artifact_new' } })
    .mockResolvedValueOnce({ kind: 'ok', revision: 5, value: { artifactId: 'artifact_new' } })
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const first = await mountSuspended(Component.default, { props: { canvas } })
  await first.get('[data-testid="learn-artifact-title"]').setValue('My plan')
  await first.get('[data-testid="learn-artifact-content"]').setValue('First copy.')
  await first.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(first.text()).toContain('Artifact saved.'))
  first.unmount()
  const restored = await mountSuspended(Component.default, { props: { canvas: { ...canvas, thread: { ...canvas.thread, revision: 4 } } } })
  await restored.get('[data-testid="learn-artifact-title"]').setValue('My plan')
  await restored.get('[data-testid="learn-artifact-content"]').setValue('Second copy.')
  await restored.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[1]![0]).toMatchObject({ artifactId: 'artifact_new', expectedRevision: 4 })
  expect(sessionStorage.getItem('learn-artifact:owner_1:thread_1:artifact_1:plan:1:pending-create')).toBeNull()
  artifacts.value = [{ id: 'artifact_new', activityId: 'artifact_1', artifactKind: 'plan', title: 'My plan', summary: 'Second copy.', status: 'saved', readOnly: false, historical: false, evidenceLabel: null }]
  await vi.waitFor(() => expect(restored.get('[data-testid="learn-artifact-saved-status"]').text()).toContain('Saved artifact'))
  expect(sessionStorage.getItem('learn-artifact:owner_1:thread_1:artifact_1:plan:1:known-id')).not.toBeNull()
  restored.unmount()
})

it('blocks Save on remount until the authoritative artifact list hydrates, then edits the known ID', async () => {
  save.mockResolvedValueOnce({ kind: 'ok', revision: 4, value: { artifactId: 'artifact_new' } })
    .mockResolvedValueOnce({ kind: 'ok', revision: 5, value: { artifactId: 'artifact_new' } })
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const first = await mountSuspended(Component.default, { props: { canvas } })
  await first.get('[data-testid="learn-artifact-title"]').setValue('My plan')
  await first.get('[data-testid="learn-artifact-content"]').setValue('First copy.')
  await first.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(first.text()).toContain('Artifact saved.'))
  artifacts.value = [{ id: 'artifact_new', activityId: 'artifact_1', artifactKind: 'plan', title: 'My plan', summary: 'First copy.', status: 'saved', readOnly: false, historical: false, evidenceLabel: null }]
  await nextTick()
  first.unmount()
  artifacts.value = null
  artifactPending.value = true
  const remounted = await mountSuspended(Component.default, { props: { canvas: { ...canvas, thread: { ...canvas.thread, revision: 4 } } } })
  expect((remounted.get('[data-testid="learn-artifact-save"]').element as HTMLButtonElement).disabled).toBe(true)
  await remounted.get('[data-testid="learn-artifact-save"]').trigger('click')
  expect(save).toHaveBeenCalledTimes(1)
  artifactPending.value = false
  artifacts.value = [{ id: 'artifact_new', activityId: 'artifact_1', artifactKind: 'plan', title: 'My plan', summary: 'First copy.', status: 'saved', readOnly: false, historical: false, evidenceLabel: null }]
  await nextTick()
  await remounted.get('[data-testid="learn-artifact-content"]').setValue('Second copy.')
  await remounted.get('[data-testid="learn-artifact-save"]').trigger('click')
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[1]![0]).toMatchObject({ artifactId: 'artifact_new', summary: 'Second copy.', expectedRevision: 4 })
  remounted.unmount()
})

it('discards expired or foreign pending-create metadata', async () => {
  const pendingKey = 'learn-artifact:owner_1:thread_1:artifact_1:plan:1:pending-create'
  sessionStorage.setItem(pendingKey, JSON.stringify({ version: 1, savedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    ownerId: 'owner_1', threadId: 'thread_1', activityId: 'artifact_1', planRevision: 1,
    snapshot: { title: 'Stale', summary: 'Stale draft.', artifactKind: 'plan', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-save:old-key' } }))
  const Component = await import('~/components/learn-adaptive/ArtifactWorkspace.vue')
  const expired = await mountSuspended(Component.default, { props: { canvas } })
  expect((expired.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).disabled).toBe(false)
  expect(sessionStorage.getItem(pendingKey)).toBeNull()
  expired.unmount()
  sessionStorage.setItem(pendingKey, JSON.stringify({ version: 1, savedAt: Date.now(),
    ownerId: 'someone_else', threadId: 'thread_1', activityId: 'artifact_1', planRevision: 1,
    snapshot: { title: 'Foreign', summary: 'Not this owner.', artifactKind: 'plan', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-save:foreign-key' } }))
  const foreign = await mountSuspended(Component.default, { props: { canvas } })
  expect((foreign.get('[data-testid="learn-artifact-content"]').element as HTMLTextAreaElement).disabled).toBe(false)
  expect(sessionStorage.getItem(pendingKey)).toBeNull()
  foreign.unmount()
})
