export const AUDIO_OVERVIEW_PROFILE_V1 = Object.freeze({
  id: 'budds-two-host-gemini-v1',
  version: 1,
  renderer: 'gemini-native-multi-speaker',
  model: 'gemini-2.5-flash-preview-tts',
  hostA: Object.freeze({ speakerName: 'Host A', voiceName: 'Kore' }),
  hostB: Object.freeze({ speakerName: 'Host B', voiceName: 'Puck' }),
  format: Object.freeze({
    encoding: 'pcm_s16le' as const,
    sampleRateHz: 24_000,
    bitDepth: 16,
    channels: 1,
  }),
  directorGuidance: [
    'Create a warm, intelligent, natural conversation between two distinct hosts.',
    'Honor the supplied emotional intent, delivery intent, and pauses without speaking the directions.',
    'Use restrained reactions, varied pacing, and subtle overlap-like timing while keeping every scripted word intelligible.',
    'Speak only the transcript; never read speaker labels, section labels, or director notes aloud.',
  ].join(' '),
})

export const AUDIO_OVERVIEW_PROFILE_V2 = Object.freeze({
  ...AUDIO_OVERVIEW_PROFILE_V1,
  id: 'budds-two-host-gemini-v2',
  version: 2,
  renderer: 'gemini-interactions-multi-speaker',
  model: 'gemini-3.1-flash-tts-preview',
})

export const AUDIO_OVERVIEW_PROFILE_CURRENT = AUDIO_OVERVIEW_PROFILE_V2
