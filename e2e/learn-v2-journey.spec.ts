import { test } from '@playwright/test'
import { runLearningJourney } from './helpers/learning-journey'

test('learner can advance the Learn V2 mastery journey through production UI', async ({ page, request }) => {
  await runLearningJourney(page, request)
})
