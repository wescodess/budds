export const FEMALE_VOICES = ['asteria', 'luna', 'stella', 'athena', 'hera'] as const
export const MALE_VOICES = ['orion', 'arcas', 'perseus', 'angus', 'orpheus', 'helios', 'zeus'] as const
export const ALL_VOICES = [...FEMALE_VOICES, ...MALE_VOICES] as const

export type HostVoice = typeof ALL_VOICES[number]
export type Complexity = 'beginner' | 'expert'
export type LengthMinutes = 5 | 10 | 20

export interface CustomizeSubmit {
  lengthMinutes: LengthMinutes
  complexity: Complexity
  voiceProfile: { hostA: HostVoice, hostB: HostVoice }
}
