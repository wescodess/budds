export const LEGACY_AUDIO_OVERVIEW_WRITES_DISABLED
  = 'Legacy Audio Overview generation is disabled; use Audio Overview v2'

export function rejectLegacyAudioOverviewWrite(): never {
  throw new Error(LEGACY_AUDIO_OVERVIEW_WRITES_DISABLED)
}
