export interface SM2Params {
  easeFactor: number
  interval: number
  repetitions: number
}

export interface SM2Result {
  easeFactor: number
  interval: number
  repetitions: number
  nextReviewDate: string
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + Math.round(days))
  return d.toISOString().slice(0, 10)
}

export function computeSM2(
  current: SM2Params,
  quality: number,
  todayStr: string,
): SM2Result {
  const newEaseFactor = Math.max(
    1.3,
    current.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02),
  )

  let newInterval: number
  let newRepetitions: number

  if (quality === 0) {
    newInterval = 1
    newRepetitions = 0
  } else if (quality === 3) {
    newInterval = current.interval * 1.2
    newRepetitions = current.repetitions + 1
  } else if (quality === 4) {
    newInterval = current.interval * current.easeFactor
    newRepetitions = current.repetitions + 1
  } else if (quality === 5) {
    newInterval = current.interval * current.easeFactor * 1.3
    newRepetitions = current.repetitions + 1
  } else {
    newInterval = 1
    newRepetitions = 0
  }

  newInterval = Math.max(1, Math.round(newInterval))

  const nextReviewDate = addDays(todayStr, newInterval)

  return {
    easeFactor: Math.round(newEaseFactor * 100) / 100,
    interval: newInterval,
    repetitions: newRepetitions,
    nextReviewDate,
  }
}
