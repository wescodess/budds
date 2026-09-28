import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const base = {
  kind: 'factual' as const, activityId: 'activity_1', eligibility: 'eligible' as const, readOnly: false,
  integrityState: 'accepted' as const,
  claims: [{ claimId: 'claim_1', claimText: 'Plants convert light energy.', claimStatus: 'unknown' as const, integrityState: 'accepted' as const,
    source: { origin: 'user_url' as const, locator: 'page:1', sourceSnapshotId: 'source_1', sourceSnapshotRevision: 3, sourceRecordRevision: 7 } }],
}

describe('adaptive Evidence drawer', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it.each(['accepted', 'insufficient', 'conflicting', 'stale', 'deleted', 'unavailable'] as const)('renders %s integrity without private payloads', async state => {
    const Comp = await import('~/components/learn-adaptive/EvidenceDrawer.vue')
    const evidence = { ...base, integrityState: state, eligibility: state === 'accepted' ? 'eligible' as const : 'blocked' as const,
      claims: [{ ...base.claims[0]!, integrityState: state, source: { ...base.claims[0]!.source, locator: ['deleted', 'unavailable', 'insufficient'].includes(state) ? null : 'page:1' } }] }
    const wrapper = await mountSuspended(Comp.default, { props: { evidence, pending: false, sourceState: 'ready', safeDestination: '/app/learn/void_1', safeDestinationLabel: 'Open your learning mission' }, attachTo: document.body })
    const trigger = wrapper.get('[data-testid="learn-evidence-open"]')
    await trigger.trigger('click')
    const drawer = document.querySelector('[data-testid="learn-evidence-drawer"]') as HTMLElement
    expect(drawer).not.toBeNull()
    expect(drawer.textContent).toContain(state)
    expect(drawer.textContent).toContain('Added by you')
    expect(drawer.textContent).toContain('Revision 3')
    expect(drawer.textContent).not.toMatch(/private|Protected source passage|r2:\/\//)
    expect(drawer.querySelector('a[href="page:1"]')).toBeNull()
    await wrapper.unmount()
  })

  it('offers only the named safe recovery in blocked or preparing states and returns focus on close', async () => {
    const Comp = await import('~/components/learn-adaptive/EvidenceDrawer.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { evidence: null, pending: false, sourceState: 'blocked', safeDestination: '/app/learn/void_1', safeDestinationLabel: 'Open your learning mission' }, attachTo: document.body })
    const trigger = wrapper.get('[data-testid="learn-evidence-open"]')
    await trigger.trigger('click')
    const drawer = document.querySelector('[data-testid="learn-evidence-drawer"]') as HTMLElement
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(drawer.textContent).toContain('blocked')
    expect(drawer.querySelector('[data-testid="learn-evidence-recovery"]')?.getAttribute('href')).toBe('/app/learn/void_1')
    expect(drawer.className).toContain('w-screen')
    expect(drawer.className).toContain('md:max-w-md')
    ;(drawer.querySelector('[data-testid="learn-evidence-close"]') as HTMLButtonElement).click()
    await nextTick()
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element))
    await wrapper.setProps({ sourceState: 'preparing' })
    await trigger.trigger('click')
    expect(document.querySelector('[data-testid="learn-evidence-drawer"]')?.textContent).toContain('preparing')
    wrapper.unmount()
  })

  it('uses the focus origin for only the external open cycle', async () => {
    const origin = document.createElement('button')
    document.body.append(origin)
    const Comp = await import('~/components/learn-adaptive/EvidenceDrawer.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { evidence: base, pending: false, sourceState: 'ready', safeDestination: '/app/learn/void_1', safeDestinationLabel: 'Open your learning mission', openRequest: 0, returnFocusTo: origin }, attachTo: document.body })
    await wrapper.setProps({ openRequest: 1 })
    let drawer = document.querySelector('[data-testid="learn-evidence-drawer"]') as HTMLElement
    ;(drawer.querySelector('[data-testid="learn-evidence-close"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.activeElement).toBe(origin))

    const trigger = wrapper.get('[data-testid="learn-evidence-open"]')
    ;(trigger.element as HTMLButtonElement).focus()
    await trigger.trigger('click')
    drawer = document.querySelector('[data-testid="learn-evidence-drawer"]') as HTMLElement
    ;(drawer.querySelector('[data-testid="learn-evidence-close"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element))
    wrapper.unmount()
    origin.remove()
  })

  it.each(['preparing', 'blocked', 'stale', 'invalidated'] as const)('shows live %s source status over retained accepted claims', async sourceState => {
    const Comp = await import('~/components/learn-adaptive/EvidenceDrawer.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { evidence: base, pending: false, sourceState, safeDestination: '/app/learn/void_1', safeDestinationLabel: 'Open your learning mission' }, attachTo: document.body })
    await wrapper.get('[data-testid="learn-evidence-open"]').trigger('click')
    const drawer = document.querySelector('[data-testid="learn-evidence-drawer"]') as HTMLElement
    expect(drawer.querySelector('[data-testid="learn-evidence-status"]')?.textContent).toContain(sourceState)
    expect(drawer.querySelector('[data-testid="learn-evidence-recovery"]')?.getAttribute('href')).toBe('/app/learn/void_1')
    wrapper.unmount()
  })

  it('does not present retained accepted claims or locators as current support after source loss', async () => {
    const Comp = await import('~/components/learn-adaptive/EvidenceDrawer.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { evidence: base, pending: false, sourceState: 'unavailable', safeDestination: '/app/learn/void_1', safeDestinationLabel: 'Open your learning mission' }, attachTo: document.body })
    await wrapper.get('[data-testid="learn-evidence-open"]').trigger('click')
    const source = document.querySelector('[data-testid="learn-source-claim_1"]') as HTMLElement
    expect(source.textContent).toContain('unavailable')
    expect(source.textContent).not.toContain('accepted')
    expect(source.textContent).not.toContain('page:1')
    wrapper.unmount()
  })

  it.each([
    ['fact', 'Fact'], ['synthesis', 'Synthesis'], ['inference', 'Inference'], ['unknown', 'Unknown'],
  ] as const)('distinguishes %s epistemic label from evidence integrity', async (claimStatus, label) => {
    const Comp = await import('~/components/learn-adaptive/EvidenceDrawer.vue')
    const evidence = { ...base, claims: [{ ...base.claims[0]!, claimStatus }] }
    const wrapper = await mountSuspended(Comp.default, { props: { evidence, pending: false, sourceState: 'ready', safeDestination: '/app/learn/void_1', safeDestinationLabel: 'Open your learning mission' }, attachTo: document.body })
    await wrapper.get('[data-testid="learn-evidence-open"]').trigger('click')
    const source = document.querySelector('[data-testid="learn-source-claim_1"]') as HTMLElement
    expect(source.textContent).toContain(`Claim type: ${label}`)
    expect(source.textContent).toContain('Integrity: accepted')
    wrapper.unmount()
  })

  it.each([
    ['preparing', 'still preparing'],
    ['blocked', 'cannot use its current evidence'],
    ['stale', 'older source revision'],
    ['invalidated', 'can no longer support'],
    ['deleted', 'was deleted'],
    ['unavailable', 'is unavailable'],
    ['insufficient', 'does not sufficiently support'],
    ['conflicting', 'conflict is unresolved'],
  ] as const)('offers a read-only %s recovery handoff', async (state, explanation) => {
    const Comp = await import('~/components/learn-adaptive/EvidenceDrawer.vue')
    const evidence = { ...base, integrityState: state === 'preparing' || state === 'blocked' || state === 'invalidated' ? 'accepted' as const : state,
      claims: [{ ...base.claims[0]!, integrityState: state === 'preparing' || state === 'blocked' || state === 'invalidated' ? 'accepted' as const : state }] }
    const sourceState = state === 'deleted' || state === 'insufficient' || state === 'conflicting' ? 'ready' : state
    const wrapper = await mountSuspended(Comp.default, { props: { evidence, pending: false, sourceState, safeDestination: '/app/learn/void_1', safeDestinationLabel: 'Open your learning mission' }, attachTo: document.body })
    await wrapper.get('[data-testid="learn-evidence-open"]').trigger('click')
    const drawer = document.querySelector('[data-testid="learn-evidence-drawer"]') as HTMLElement
    expect(drawer.querySelector('[data-testid="learn-evidence-recovery-copy"]')?.textContent).toContain(explanation)
    expect(drawer.querySelector('[data-testid="learn-evidence-recovery-copy"]')?.textContent).toContain('This drawer is read-only; the named destination is the smallest authorized place to check source status or make changes.')
    expect(drawer.querySelector('[data-testid="learn-evidence-recovery"]')?.textContent).toBe('Open your learning mission')
    wrapper.unmount()
  })

  it.each([390, 700, 1280])('mounts an operable drawer at %ipx viewport width', async width => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const Comp = await import('~/components/learn-adaptive/EvidenceDrawer.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { evidence: base, pending: false, sourceState: 'ready', safeDestination: '/app/learn/void_1', safeDestinationLabel: 'Open your learning mission' }, attachTo: document.body })
    await wrapper.get('[data-testid="learn-evidence-open"]').trigger('click')
    const drawer = document.querySelector('[data-testid="learn-evidence-drawer"]') as HTMLElement
    expect(drawer.textContent).toContain('Plants convert light energy.')
    expect(drawer.className).toContain('w-screen')
    expect(drawer.className).toContain('md:max-w-md')
    expect(drawer.className).not.toContain('sm:max-w-md')
    wrapper.unmount()
  })
})
