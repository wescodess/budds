import { beforeEach, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const memory = {
  threadRevision: 4, lifecycle: 'active', unresolvedPoint: 'Explain the core idea',
  nextAction: { kind: 'continue', label: 'Try an example', reasonCode: 'ready', activityId: 'activity-1' },
  evidenceState: 'ready',
  preferences: [{ key: 'representation', value: 'Use diagrams', state: 'active', revision: 1 }],
  artifacts: [{ id: 'artifact-1', kind: 'plan', title: 'My plan', summary: 'Three steps', status: 'saved', revision: 1, updatedAt: 1,
    historical: false, readOnly: false, evidenceLabel: null }],
  history: [{ activityId: 'activity-1', purpose: 'Practice', status: 'feedback', activityClass: 'non_factual', updatedAt: 1, readOnly: true,
    evidenceStatus: 'not_required', attempt: null }],
} as const

beforeEach(() => { document.body.innerHTML = '' })

it('separates editable memory from read-only history and emits explicit intents', async () => {
  const Comp = await import('~/components/learn-adaptive/MemoryDrawer.vue')
  const wrapper = await mountSuspended(Comp.default, { props: { memory, pending: false }, attachTo: document.body })
  const trigger = wrapper.get('[data-testid="learn-memory-open"]')
  await trigger.trigger('click')
  const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
  expect(drawer.getAttribute('role')).toBe('dialog')
  expect(drawer.textContent).toContain('Explain the core idea')
  expect(drawer.textContent).toContain('My plan')
  expect(drawer.textContent).toContain('Past activity, read-only')
  expect(drawer.querySelector('[data-testid="learn-memory-history"] button')).toBeNull()
  const input = drawer.querySelector('[data-testid="learn-memory-preference-representation"]') as HTMLInputElement
  input.value = 'Use short diagrams'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  ;(drawer.querySelector('[data-testid="learn-memory-save-representation"]') as HTMLButtonElement).click()
  await vi.waitFor(() => expect(wrapper.emitted('set-preference')?.[0]).toEqual([{ key: 'representation', operation: 'set', value: 'Use short diagrams' }]))
  expect(drawer.querySelector('[role="status"]')?.textContent).toContain('Waiting for confirmation')
  ;(drawer.querySelector('[data-testid="learn-memory-delete-artifact-1"]') as HTMLButtonElement).click()
  expect(wrapper.emitted('delete-artifact')).toBeUndefined()
  await nextTick()
  ;(drawer.querySelector('[data-testid="learn-memory-confirm-delete-artifact-1"]') as HTMLButtonElement).click()
  expect(wrapper.emitted('delete-artifact')?.[0]).toEqual(['artifact-1'])
  ;(drawer.querySelector('[data-testid="learn-memory-close"]') as HTMLButtonElement).click()
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element))
  wrapper.unmount()
})

it('offers review and mastery only when a learner chooses a pinned source', async () => {
  const Comp = await import('~/components/learn-adaptive/MemoryDrawer.vue')
  const projected = { ...memory,
    promotionCandidates: [
      { basis: 'useful_artifact' as const, sourceId: 'artifact-1', label: 'My plan', allowedKinds: ['review', 'mastery'] as const },
      { basis: 'representative_performance' as const, sourceId: 'activity-2', label: 'Practice result', allowedKinds: ['review'] as const },
    ],
    promotionProposals: [{ id: 'proposal-1', kind: 'review' as const, basis: 'useful_artifact' as const, sourceLabel: 'My plan' }],
  }
  const wrapper = await mountSuspended(Comp.default, { props: { memory: projected, pending: false }, attachTo: document.body })
  await wrapper.get('[data-testid="learn-memory-open"]').trigger('click')
  const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
  expect(drawer.textContent).toContain('Review proposed from My plan')
  expect(drawer.textContent).toContain('Assisted work still needs independent evidence before mastery can advance.')
  expect((drawer.querySelector('[data-testid="learn-memory-promote-mastery-artifact-1"]') as HTMLButtonElement).textContent).toContain('Explore mastery path')
  expect(drawer.querySelectorAll('[data-testid^="learn-memory-promote-"]')).toHaveLength(3)
  ;(drawer.querySelector('[data-testid="learn-memory-promote-review-artifact-1"]') as HTMLButtonElement).click()
  expect(wrapper.emitted('request-promotion')?.[0]).toEqual([{ kind: 'review', basis: 'useful_artifact', sourceId: 'artifact-1' }])
  expect(drawer.querySelector('[data-testid="learn-memory-promote-mastery-activity-2"]')).toBeNull()
  wrapper.unmount()
})

it('labels stale artifacts and shows only verified score and mastery facts in read-only history', async () => {
  const Comp = await import('~/components/learn-adaptive/MemoryDrawer.vue')
  const projected = {
    ...memory,
    artifacts: [{ ...memory.artifacts[0]!, historical: true, readOnly: true, evidenceLabel: 'evidence_unavailable' as const }],
    history: [{ activityId: 'activity-2', purpose: 'Apply the concept', status: 'feedback', activityClass: 'factual', updatedAt: 2, readOnly: true as const,
      evidenceStatus: 'unavailable' as const, attempt: { id: 'attempt-1', scorePercent: 83, masteryStateAfter: 'working' } }],
  }
  const wrapper = await mountSuspended(Comp.default, { props: { memory: projected, pending: false }, attachTo: document.body })
  await wrapper.get('[data-testid="learn-memory-open"]').trigger('click')
  const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
  expect(drawer.textContent).toContain('Historical artifact · supporting evidence unavailable · read-only content')
  expect(drawer.querySelector('[data-testid="learn-memory-history"]')?.textContent).toContain('Verified attempt score: 83%')
  expect(drawer.querySelector('[data-testid="learn-memory-history"]')?.textContent).toContain('Mastery after attempt: working')
  expect(drawer.querySelector('[data-testid="learn-memory-history"] button')).toBeNull()
  wrapper.unmount()
})

it('keeps a stale edit visible and announces a recovery action', async () => {
  const Comp = await import('~/components/learn-adaptive/MemoryDrawer.vue')
  const wrapper = await mountSuspended(Comp.default, { props: { memory, pending: false, error: 'Memory changed in another tab. Refresh and try again.' }, attachTo: document.body })
  await wrapper.get('[data-testid="learn-memory-open"]').trigger('click')
  const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
  const input = drawer.querySelector('[data-testid="learn-memory-preference-representation"]') as HTMLInputElement
  input.value = 'Keep my edit'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await wrapper.setProps({ memory: { ...memory, threadRevision: 5 } })
  expect(input.value).toBe('Keep my edit')
  expect(drawer.querySelector('[role="alert"]')?.textContent).toContain('Refresh and try again')
  ;(drawer.querySelector('[data-testid="learn-memory-refresh"]') as HTMLButtonElement).click()
  expect(wrapper.emitted('refresh')?.length).toBe(1)
  wrapper.unmount()
})

it('fills preferences when memory arrives after opening and restores external focus', async () => {
  const origin = document.createElement('button')
  document.body.append(origin)
  const Comp = await import('~/components/learn-adaptive/MemoryDrawer.vue')
  const wrapper = await mountSuspended(Comp.default, { props: { memory: null, pending: true, openRequest: 0, returnFocusTo: origin }, attachTo: document.body })
  await wrapper.setProps({ openRequest: 1 })
  await wrapper.setProps({ memory, pending: false })
  const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
  expect((drawer.querySelector('[data-testid="learn-memory-preference-representation"]') as HTMLInputElement).value).toBe('Use diagrams')
  ;(drawer.querySelector('[data-testid="learn-memory-close"]') as HTMLButtonElement).click()
  await vi.waitFor(() => expect(document.activeElement).toBe(origin))
  wrapper.unmount()
  origin.remove()
})

it('uses a modal mobile Sheet with keyboard dismissal and labeled controls', async () => {
  const Comp = await import('~/components/learn-adaptive/MemoryDrawer.vue')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  const outside = document.createElement('button')
  outside.textContent = 'Outside'
  document.body.append(outside)
  const wrapper = await mountSuspended(Comp.default, { props: { memory, pending: false }, attachTo: document.body })
  const trigger = wrapper.get('[data-testid="learn-memory-open"]')
  await trigger.trigger('click')
  const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
  expect(drawer.className).toContain('w-screen')
  expect(drawer.getAttribute('role')).toBe('dialog')
  expect(drawer.querySelector('[aria-modal="true"]') ?? drawer.getAttribute('aria-modal')).toBeTruthy()
  const input = drawer.querySelector('[data-testid="learn-memory-preference-representation"]') as HTMLInputElement
  expect(input.labels?.[0]?.textContent).toContain('Preferred representation')
  expect((drawer.querySelector('[data-testid="learn-memory-close"]') as HTMLButtonElement).className).toContain('min-h-11')
  outside.focus()
  await vi.waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true))
  drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element))
  wrapper.unmount()
  outside.remove()
})
