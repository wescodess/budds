import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { deniedRead, resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

mockNuxtImport('useConvex', () => () => teachingClient)

const overview = teachingRead('audioOverviews:getCourseScopedOverview')
const componentPath = ['~', 'components', 'learn', 'AudioBlock.vue'].join('/')

const sampleOverview = {
  _id: 'audio_123',
  title: 'Reaction Mechanisms Primer',
  status: 'ready',
  turns: [
    { speaker: 'host_a', text: 'Welcome! In your lecture notes, you mention SN1 reactions.', audioFileId: 'file_1', durationMs: 4000, sourceIndex: 0 },
    { speaker: 'host_b', text: 'Right, that sounds interesting. What makes them different?', audioFileId: 'file_2', durationMs: 3500, sourceIndex: 1 },
  ],
  turnUrls: ['https://audio.test/1.mp3', 'https://audio.test/2.mp3'],
  voiceProfile: { hostA: 'asteria', hostB: 'orion' },
  totalDurationMs: 7500,
  sourceDocumentIds: [],
  sourceFilenames: ['lecture-7.pdf', 'reactions.pdf'],
}

describe('AudioBlock with responses on', () => {
  beforeEach(() => {
    resetTeachingReads()
  })

  it('pauses without retry while a check is open', async () => {
    overview.error.value = deniedRead('test_open')
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    const paused = wrapper.get('[data-testid="audio-read-paused"]')
    expect(paused.attributes('role')).toBe('status')
    expect(paused.text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
    expect(wrapper.find('[data-testid="audio-read-retry"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Loading audio data')
  })

  it('says plainly when disclosure is unknown', async () => {
    overview.error.value = deniedRead('disclosure_unknown')
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    expect(wrapper.get('[data-testid="audio-read-paused"]').text()).toBe('This isn’t available right now.')
    expect(wrapper.find('[data-testid="audio-read-retry"]').exists()).toBe(false)
  })

  it('retries a failed read by subscribing again and recovers to the player', async () => {
    overview.error.value = new Error('network')
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    expect(wrapper.get('[data-testid="audio-read-error"]').text()).toContain('Could not load this audio overview.')
    expect(wrapper.find('[data-testid="audio-block-play"]').exists()).toBe(false)
    const before = overview.subscriptions
    overview.error.value = null
    await wrapper.get('[data-testid="audio-read-retry"]').trigger('click')
    expect(overview.subscriptions).toBe(before + 1)
    overview.data.value = sampleOverview
    await vi.waitFor(() => expect(wrapper.find('[data-testid="audio-block-play"]').exists()).toBe(true))
    expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
  })

  it('clears a stale error when the live subscription later succeeds', async () => {
    overview.error.value = new Error('network')
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(true)
    overview.error.value = null
    overview.data.value = sampleOverview
    await vi.waitFor(() => expect(wrapper.find('[data-testid="audio-block-play"]').exists()).toBe(true))
    expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
  })

  it.each(['test_open', 'unavailable'] as const)('stops playback and clears the transcript when a check opens mid-play, then reloads on recovery (%s)', async (reason) => {
    overview.data.value = sampleOverview
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    const audio = wrapper.get('audio').element as HTMLAudioElement
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {})
    vi.spyOn(audio, 'play').mockResolvedValue(undefined)
    vi.spyOn(audio, 'load').mockImplementation(() => {})
    await wrapper.get('[data-testid="audio-block-play"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="audio-block-play"]').attributes('aria-label')).toBe('Pause audio primer')
    expect(audio.getAttribute('src')).toBe('https://audio.test/1.mp3')
    await wrapper.find('[data-testid="audio-block-transcript-toggle"]').trigger('click')
    expect(wrapper.text()).toContain('SN1 reactions')

    overview.error.value = deniedRead(reason)
    await nextTick()
    expect(pause).toHaveBeenCalled()
    expect(audio.getAttribute('src')).toBeNull()
    expect(wrapper.find(`[data-testid="audio-read-${reason === 'unavailable' ? 'error' : 'paused'}"]`).exists()).toBe(true)
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(wrapper.find('[data-testid="audio-block-play"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('SN1 reactions')
    expect(wrapper.text()).not.toContain('Reaction Mechanisms Primer')

    overview.error.value = null
    await nextTick()
    expect(wrapper.find(`[data-testid="audio-read-${reason === 'unavailable' ? 'error' : 'paused'}"]`).exists()).toBe(false)
    expect(wrapper.text()).toContain('Reaction Mechanisms Primer')
    expect(wrapper.get('[data-testid="audio-block-play"]').attributes('aria-label')).toBe('Play audio primer')
    expect(wrapper.text()).not.toContain('SN1 reactions')
  })

  it('ignores read failures when there is no audio to load', async () => {
    overview.error.value = new Error('network')
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: {} })
    expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No audio available')
  })
})
