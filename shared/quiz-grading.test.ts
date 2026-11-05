import { describe, expect, test } from 'vitest'
import { defaultQuizGradingCriteria, getDeterministicQuizGrade, scoreQuizCriteria, validateQuizGradingCriteria, type QuizGradingCriterion } from './quiz-grading'

const criteria: QuizGradingCriterion[] = [
  { key: 'daughter_cells', description: 'Two daughter cells', weightPercent: 40 },
  { key: 'identical', description: 'Genetically identical', weightPercent: 60 },
]

describe('quiz grading criteria', () => {
  test('accepts one to four criteria and copies the pinned values', () => {
    const validated = validateQuizGradingCriteria(criteria)
    expect(validated).toEqual(criteria)
    expect(validated[0]).not.toBe(criteria[0])
    expect(validateQuizGradingCriteria([{ key: 'a'.repeat(40), description: 'a'.repeat(300), weightPercent: 100 }])).toHaveLength(1)
    expect(validateQuizGradingCriteria(Array.from({ length: 4 }, (_, index) => ({ key: `part_${index}`, description: '', weightPercent: 25 })))).toHaveLength(4)
  })

  test.each([
    [],
    Array.from({ length: 5 }, (_, index) => ({ key: `part_${index}`, description: '', weightPercent: 20 })),
    [criteria[0]!, { ...criteria[1]!, key: criteria[0]!.key }],
    ...['', 'Uppercase', 'space key', 'hyphen-key', 'é', 'a'.repeat(41), 'key\n'].map(key => [{ key, description: '', weightPercent: 100 }]),
    [{ key: 'a', description: 'a'.repeat(301), weightPercent: 100 }],
    ...[0, -1, 99, 101, 50.5, NaN, Infinity].map(weightPercent => [{ key: 'a', description: '', weightPercent }]),
    [{ ...criteria[0]!, weightPercent: 40.5 }, { ...criteria[1]!, weightPercent: 59.5 }],
  ].map(invalid => [invalid]))('rejects an invalid rubric: %j', (invalid) => {
    expect(() => validateQuizGradingCriteria(invalid)).toThrow('Invalid quiz grading criteria')
  })

  test('derives a bounded fallback criterion from the reference answer', () => {
    const fallback = defaultQuizGradingCriteria('  Two identical daughter cells  ')
    expect(fallback).toEqual([{ key: 'reference_answer', description: 'Conveys the reference answer: Two identical daughter cells', weightPercent: 100 }])
    expect(validateQuizGradingCriteria(fallback)).toEqual(fallback)
    expect(defaultQuizGradingCriteria('a'.repeat(500))[0]!.description).toHaveLength(300)
  })
})

describe('quiz criterion scoring', () => {
  test.each([
    ['met', 'met', { credit: 1, label: 'fully_correct' }],
    ['not_met', 'not_met', { credit: 0, label: 'incorrect' }],
    ['met', 'not_met', { credit: 0.4, label: 'partially_correct' }],
    ['not_met', 'met', { credit: 0.6, label: 'partially_correct' }],
    ['uncertain', 'met', { label: 'uncertain' }],
    ['not_met', 'uncertain', { label: 'uncertain' }],
  ] as const)('scores %s / %s without treating uncertainty as failure', (first, second, expected) => {
    expect(scoreQuizCriteria(criteria, [{ key: 'identical', verdict: second }, { key: 'daughter_cells', verdict: first }])).toEqual(expected)
  })

  test('requires every pinned key exactly once, even for uncertain results', () => {
    for (const results of [
      [],
      [{ key: 'daughter_cells', verdict: 'uncertain' as const }],
      [{ key: 'daughter_cells', verdict: 'met' as const }, { key: 'daughter_cells', verdict: 'not_met' as const }],
      [{ key: 'daughter_cells', verdict: 'met' as const }, { key: 'unknown', verdict: 'uncertain' as const }],
    ]) expect(() => scoreQuizCriteria(criteria, results)).toThrow('Criterion results do not match the pinned rubric')
  })
})

test('only empty and exact normalized answers have a deterministic grade', () => {
  expect(getDeterministicQuizGrade('  Two\n IDENTICAL cells ', 'two identical cells')).toEqual({ credit: 1, label: 'fully_correct' })
  expect(getDeterministicQuizGrade(' \n\t ', 'two identical cells')).toEqual({ credit: 0, label: 'incorrect' })
  expect(getDeterministicQuizGrade('', '')).toEqual({ credit: 0, label: 'incorrect' })
  expect(getDeterministicQuizGrade('A pair of identical cells', 'two identical cells')).toBeNull()
})
