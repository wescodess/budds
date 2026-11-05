import { expect, test } from '@playwright/test'
import { runLearningJourney } from './helpers/learning-journey'

test('ready V2 session stages and scores a response through the real Adaptive Canvas', async ({ page, request }) => {
  expect(process.env.BUDDS_E2E_REAL_ADAPTIVE_CANVAS).toBe('true')
  expect(process.env.BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL).toBe('true')
  await runLearningJourney(page, request, true)
})
