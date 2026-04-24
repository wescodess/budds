export function getTodayInTimezone(timezone?: string): string {
  if (timezone) {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    } catch {
      // fall through to UTC
    }
  }
  return new Date().toISOString().slice(0, 10)
}
