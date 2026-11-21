import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockOverviewData = ref<any>(null)
const mockOverviewError = ref<any>(null)
const mockRefresh = vi.fn()
const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })

mockNuxtImport('useConvexQuery', () => {
  return (_apiRef: any, _args?: any) => {
    return { data: mockOverviewData, error: mockOverviewError, refresh: mockRefresh }
  }
})

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

describe('AudioBlock', () => {
  beforeEach(() => {
    mockOverviewData.value = null
    mockOverviewError.value = null
    mockRefresh.mockReset()
  })

  it('pauses without retry while a check is open', async () => {
    mockOverviewError.value = denied('test_open')
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    const paused = wrapper.get('[data-testid="audio-read-paused"]')
    expect(paused.attributes('role')).toBe('status')
    expect(paused.text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
    expect(wrapper.find('[data-testid="audio-read-retry"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Loading audio data')
  })

  it('says plainly when disclosure is unknown', async () => {
    mockOverviewError.value = denied('disclosure_unknown')
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    expect(wrapper.get('[data-testid="audio-read-paused"]').text()).toBe('This isn’t available right now.')
    expect(wrapper.find('[data-testid="audio-read-retry"]').exists()).toBe(false)
  })

  it('retries a failed read and recovers to the player', async () => {
    mockOverviewError.value = new Error('network')
    mockRefresh.mockImplementation(() => {
      mockOverviewError.value = null
      mockOverviewData.value = sampleOverview
    })
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    expect(wrapper.get('[data-testid="audio-read-error"]').text()).toContain('Could not load this audio overview.')
    expect(wrapper.find('[data-testid="audio-block-play"]').exists()).toBe(false)
    await wrapper.get('[data-testid="audio-read-retry"]').trigger('click')
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="audio-block-play"]').exists()).toBe(true))
    expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
  })

  it('stops playback and clears the transcript when a check opens mid-play, then reloads on recovery', async () => {
    mockOverviewData.value = sampleOverview
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

    mockOverviewError.value = denied('test_open')
    await nextTick()
    expect(pause).toHaveBeenCalled()
    expect(audio.getAttribute('src')).toBeNull()
    expect(wrapper.find('[data-testid="audio-read-paused"]').exists()).toBe(true)
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(wrapper.find('[data-testid="audio-block-play"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('SN1 reactions')
    expect(wrapper.text()).not.toContain('Reaction Mechanisms Primer')

    mockOverviewError.value = null
    await nextTick()
    expect(wrapper.find('[data-testid="audio-read-paused"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Reaction Mechanisms Primer')
    expect(wrapper.get('[data-testid="audio-block-play"]').attributes('aria-label')).toBe('Play audio primer')
    expect(wrapper.text()).not.toContain('SN1 reactions')
  })

  it('ignores read failures when there is no audio to load', async () => {
    mockOverviewError.value = new Error('network')
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: {} })
    expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No audio available')
  })

  it('shows loading state when no entityId', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: {},
    })
    expect(wrapper.find('[data-testid="audio-block"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No audio available')
  })

  it('shows loading state when data not yet loaded', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    expect(wrapper.text()).toContain('Loading audio data')
  })

  it('renders player with title and duration when data loaded', async () => {
    mockOverviewData.value = sampleOverview
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    expect(wrapper.text()).toContain('Reaction Mechanisms Primer')
    expect(wrapper.text()).toContain('0:08')
    expect(wrapper.find('[data-testid="audio-block-play"]').exists()).toBe(true)
  })

  it('renders play button with accessible label', async () => {
    mockOverviewData.value = sampleOverview
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    const playBtn = wrapper.find('[data-testid="audio-block-play"]')
    expect(playBtn.attributes('aria-label')).toBe('Play audio primer')
  })

  it('renders transcript toggle', async () => {
    mockOverviewData.value = sampleOverview
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    const toggle = wrapper.find('[data-testid="audio-block-transcript-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toContain('Transcript')
  })

  it('expands transcript on click', async () => {
    mockOverviewData.value = sampleOverview
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    expect(wrapper.find('[data-testid="audio-block-transcript"]').exists()).toBe(false)
    await wrapper.find('[data-testid="audio-block-transcript-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="audio-block-transcript"]').exists()).toBe(true)
  })

  it('shows transcript lines with speaker labels', async () => {
    mockOverviewData.value = sampleOverview
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    await wrapper.find('[data-testid="audio-block-transcript-toggle"]').trigger('click')
    const transcript = wrapper.find('[data-testid="audio-block-transcript"]')
    expect(transcript.text()).toContain('Host A')
    expect(transcript.text()).toContain('Host B')
    expect(transcript.text()).toContain('SN1 reactions')
  })

  it('renders source attribution pills', async () => {
    mockOverviewData.value = sampleOverview
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    const sources = wrapper.find('[data-testid="audio-block-sources"]')
    expect(sources.exists()).toBe(true)
    expect(sources.text()).toContain('lecture-7.pdf')
    expect(sources.text()).toContain('reactions.pdf')
  })

  it('hides source attribution when no filenames', async () => {
    mockOverviewData.value = { ...sampleOverview, sourceFilenames: [] }
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    expect(wrapper.find('[data-testid="audio-block-sources"]').exists()).toBe(false)
  })

  it('renders progress bar', async () => {
    mockOverviewData.value = sampleOverview
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    expect(wrapper.find('[data-testid="audio-block-progress"]').exists()).toBe(true)
  })

  it('renders Audio Primer label', async () => {
    mockOverviewData.value = sampleOverview
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { entityId: 'audio_123' },
    })
    expect(wrapper.text()).toContain('Audio Primer')
  })
})
