export interface StreakState {
  streakCurrent: number
  streakLastDate: string | undefined
  streakFreezeAvailable: boolean
  streakFreezeUsedAt: string | undefined
}

export interface StreakResult {
  streakCurrent: number
  streakLastDate: string
  streakFreezeAvailable: boolean
  streakFreezeUsedAt: string | undefined
  frozeToday: boolean
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + 'T00:00:00Z')
  const b = new Date(dateB + 'T00:00:00Z')
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

function isMondayOrLater(lastUsed: string | undefined, today: string): boolean {
  if (!lastUsed) return true
  const todayDate = new Date(today + 'T00:00:00Z')
  const lastUsedDate = new Date(lastUsed + 'T00:00:00Z')

  const todayDay = todayDate.getUTCDay()
  const mondayOffset = todayDay === 0 ? 6 : todayDay - 1
  const thisMonday = new Date(todayDate)
  thisMonday.setUTCDate(thisMonday.getUTCDate() - mondayOffset)

  return lastUsedDate < thisMonday
}

export function evaluateStreak(
  state: StreakState,
  todayStr: string,
): StreakResult {
  const freezeAvailable = isMondayOrLater(state.streakFreezeUsedAt, todayStr)
    ? true
    : state.streakFreezeAvailable

  if (!state.streakLastDate) {
    return {
      streakCurrent: 1,
      streakLastDate: todayStr,
      streakFreezeAvailable: freezeAvailable,
      streakFreezeUsedAt: state.streakFreezeUsedAt,
      frozeToday: false,
    }
  }

  const gap = daysBetween(state.streakLastDate, todayStr)

  if (gap === 0) {
    return {
      streakCurrent: state.streakCurrent,
      streakLastDate: state.streakLastDate,
      streakFreezeAvailable: freezeAvailable,
      streakFreezeUsedAt: state.streakFreezeUsedAt,
      frozeToday: false,
    }
  }

  if (gap === 1) {
    return {
      streakCurrent: state.streakCurrent + 1,
      streakLastDate: todayStr,
      streakFreezeAvailable: freezeAvailable,
      streakFreezeUsedAt: state.streakFreezeUsedAt,
      frozeToday: false,
    }
  }

  if (gap === 2 && freezeAvailable) {
    return {
      streakCurrent: state.streakCurrent + 1,
      streakLastDate: todayStr,
      streakFreezeAvailable: false,
      streakFreezeUsedAt: todayStr,
      frozeToday: true,
    }
  }

  return {
    streakCurrent: 1,
    streakLastDate: todayStr,
    streakFreezeAvailable: freezeAvailable,
    streakFreezeUsedAt: state.streakFreezeUsedAt,
    frozeToday: false,
  }
}
