export const AUDIO_OVERVIEW_DAILY_CAP = 10
export const AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES = 50

export function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10)
}
