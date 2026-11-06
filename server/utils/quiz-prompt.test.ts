import { describe, test, expect } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from '../../convex/_generated/api'
import schema from '../../convex/schema'
import type { AISearchChunk } from './ai-search'
import { buildQuizPrompt, parseQuizResponse } from './quiz-prompt'

const chunks: AISearchChunk[] = [
  {
    id: 'c1',
    score: 0.9,
    content: 'Photosynthesis converts light energy into chemical energy stored in glucose.',
    attributes: { filename: 'biology-ch3.pdf' },
  },
  {
    id: 'c2',
    score: 0.85,
    content: 'Mitochondria are the powerhouse of the cell and produce ATP via cellular respiration.',
    attributes: { filename: 'biology-ch4.pdf' },
  },
  {
    id: 'c3',
    score: 0.8,
    content: 'The Krebs cycle generates NADH and FADH2 for the electron transport chain.',
    attributes: { filename: 'biology-ch4.pdf' },
  },
]

test('generated free-response criteria survive parsing and persistence', async () => {
  const t = convexTest(schema, import.meta.glob('../../convex/**/*.ts'))
  const user = t.withIdentity({ tokenIdentifier: 'https://auth.example.com|generated-rubrics' })
  const folderId = await user.mutation(api.folders.createFolder, { name: 'Biology' })
  const gradingCriteria = [{ key: 'conversion', description: 'Describes light becoming chemical energy.', weightPercent: 100 }]
  const parsed = parseQuizResponse(JSON.stringify({ title: 'Generated', questions: [{
    order: 0, question: 'Define photosynthesis.', type: 'free-response', correctAnswer: 'Light becomes chemical energy.', sourceIndex: 0, gradingCriteria,
  }] }))
  const { quizId } = await user.mutation(api.quizzes.createWithQuestions, {
    folderId, title: parsed.title, questions: parsed.questions.map(({ sourceIndex, ...q }) => ({ ...q, sourceChunkContent: chunks[sourceIndex]?.content })),
  })
  const row = await t.run(ctx => ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).unique())
  expect(row?.gradingCriteria).toEqual(gradingCriteria)
})

describe('buildQuizPrompt', () => {
  test('emits system + user messages referencing each source index', () => {
    const messages = buildQuizPrompt(chunks, { questionCount: 5 })
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toMatch(/Target 5 questions/)
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toContain('[Source 0: biology-ch3.pdf]')
    expect(messages[1]!.content).toContain('[Source 2: biology-ch4.pdf]')
    expect(messages[0]!.content).toContain('Only free-response items include "gradingCriteria"')
    expect(messages[0]!.content).toContain('judging meaning, not wording')
    expect(messages[0]!.content).toContain('supported by the cited source passage')
  })

  test('clamps questionCount into 3..8', () => {
    expect(buildQuizPrompt(chunks, { questionCount: 1 })[0]!.content).toMatch(/Target 3 questions/)
    expect(buildQuizPrompt(chunks, { questionCount: 99 })[0]!.content).toMatch(/Target 50 questions/)
  })
})

describe('parseQuizResponse', () => {
  const criterion = { key: 'light_energy', description: 'Identifies light as the energy input.', weightPercent: 100 }
  const freeResponse = { order: 0, question: 'Define photosynthesis.', type: 'free-response', correctAnswer: 'Light becomes chemical energy.', sourceIndex: 0 }

  test('preserves valid free-response criteria', () => {
    const result = parseQuizResponse(JSON.stringify({ questions: [{ ...freeResponse, gradingCriteria: [criterion] }] }))
    expect(result.questions[0]?.gradingCriteria).toEqual([criterion])
  })

  test.each([
    ['bad weights', [{ ...criterion, weightPercent: 99 }]],
    ['fractional weights', [{ ...criterion, weightPercent: 100.5 }]],
    ['zero weight', [{ ...criterion, weightPercent: 0 }, { ...criterion, key: 'other' }]],
    ['duplicate keys', [{ ...criterion, weightPercent: 50 }, { ...criterion, weightPercent: 50 }]],
    ['too many', Array.from({ length: 5 }, (_, i) => ({ ...criterion, key: `key_${i}`, weightPercent: 20 }))],
    ['overlong description', [{ ...criterion, description: 'x'.repeat(301) }]],
    ['uppercase key', [{ ...criterion, key: 'Light' }]],
    ['malformed entry', [null]],
    ['malformed field', 'not an array'],
    ['missing description', [{ key: 'light_energy', weightPercent: 100 }]],
    ['null', null],
    ['empty', []],
  ])('drops only criteria for %s', (_label, gradingCriteria) => {
    const result = parseQuizResponse(JSON.stringify({ questions: [{ ...freeResponse, gradingCriteria }] }))
    expect(result.questions).toEqual([freeResponse])
    expect(result.questions[0]).not.toHaveProperty('gradingCriteria')
  })

  test.each([
    { type: 'multiple-choice', options: ['A', 'B', 'C', 'D'], correctAnswer: 'A' },
    { type: 'true_false', options: ['True', 'False'], correctAnswer: 'True' },
    { type: 'fill_in_the_blank', correctAnswer: 'light' },
  ])('omits criteria on $type', (question) => {
    const result = parseQuizResponse(JSON.stringify({ questions: [{ ...freeResponse, ...question, gradingCriteria: [criterion] }] }))
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]).not.toHaveProperty('gradingCriteria')
  })

  test('parses happy-path JSON with valid MC + free-response questions', () => {
    const raw = JSON.stringify({
      title: 'Cellular Biology Quiz',
      questions: [
        {
          order: 0,
          question: 'What do mitochondria produce?',
          type: 'multiple-choice',
          options: ['ATP', 'DNA', 'RNA', 'Glucose'],
          correctAnswer: 'ATP',
          sourceIndex: 1,
        },
        {
          order: 1,
          question: 'Define photosynthesis in one sentence.',
          type: 'free-response',
          correctAnswer: 'Converting light energy into chemical energy in glucose.',
          sourceIndex: 0,
        },
      ],
    })

    const result = parseQuizResponse(raw)
    expect(result.title).toBe('Cellular Biology Quiz')
    expect(result.questions).toHaveLength(2)
    expect(result.questions[0]!.type).toBe('multiple-choice')
    expect(result.questions[1]!.type).toBe('free-response')
  })

  test('unwraps markdown-fenced responses before parsing', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'Fenced Quiz',
      questions: [
        {
          order: 0,
          question: 'What produces ATP?',
          type: 'free-response',
          correctAnswer: 'Mitochondria',
          sourceIndex: 1,
        },
      ],
    }) + '\n```'

    const result = parseQuizResponse(raw)
    expect(result.title).toBe('Fenced Quiz')
    expect(result.questions).toHaveLength(1)
  })

  test('drops invalid questions but keeps valid ones', () => {
    const raw = JSON.stringify({
      title: 'Mixed Quiz',
      questions: [
        {
          order: 0,
          question: 'Good MC question?',
          type: 'multiple-choice',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 'A',
          sourceIndex: 0,
        },
        {
          order: 1,
          question: 'Bad MC — only 3 options',
          type: 'multiple-choice',
          options: ['A', 'B', 'C'],
          correctAnswer: 'A',
          sourceIndex: 0,
        },
        {
          order: 2,
          question: 'Bad MC — correctAnswer not in options',
          type: 'multiple-choice',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 'Z',
          sourceIndex: 0,
        },
        {
          order: 3,
          question: 'Bad — missing correctAnswer',
          type: 'free-response',
          sourceIndex: 0,
        },
        {
          order: 4,
          question: 'Good free-response',
          type: 'free-response',
          correctAnswer: 'ok',
          sourceIndex: 1,
        },
      ],
    })

    const result = parseQuizResponse(raw)
    expect(result.questions).toHaveLength(2)
    expect(result.questions.map((q) => q.order)).toEqual([0, 4])
  })

  test('returns empty questions when parse fails', () => {
    expect(parseQuizResponse('garbage not json')).toEqual({ title: 'Quiz', questions: [] })
  })

  test('tolerates trailing commas', () => {
    const raw = '{"title":"Tolerant","questions":[{"order":0,"question":"Q?","type":"free-response","correctAnswer":"A","sourceIndex":0,},],}'
    const result = parseQuizResponse(raw)
    expect(result.title).toBe('Tolerant')
    expect(result.questions).toHaveLength(1)
  })
})
