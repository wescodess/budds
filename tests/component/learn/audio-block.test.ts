import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockOverviewData = ref<any>(null)
const mockOverviewError = ref<any>(null)

mockNuxtImport('useConvexQuery', () => {
  return (_apiRef: any, _args?: any) => {
    return { data: mockOverviewData, error: mockOverviewError }
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
  })

  it('matches dev while responses are off: a stale SSR error never hides the overview that arrives later', async () => {
    mockOverviewError.value = new Error('SSR query failed')
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    expect(wrapper.text()).toContain('Loading audio data')
    mockOverviewData.value = sampleOverview
    await nextTick()
    expect(mockOverviewError.value).not.toBeNull()
    expect(wrapper.text()).toContain('Reaction Mechanisms Primer')
    expect(wrapper.find('audio').exists()).toBe(true)
    expect(wrapper.get('[data-testid="audio-block-play"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="audio-read-paused"]').exists()).toBe(false)
  })

  it('ignores denial-shaped errors while responses are off', async () => {
    mockOverviewData.value = sampleOverview
    mockOverviewError.value = Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode: 'test_open' } } })
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { entityId: 'audio_123' } })
    expect(wrapper.text()).toContain('Reaction Mechanisms Primer')
    expect(wrapper.find('[data-testid="audio-read-paused"]').exists()).toBe(false)
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
