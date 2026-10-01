import { test } from '@playwright/test'
import { runLearningJourney } from './helpers/learning-journey'

test('accepted adaptive attempt passes through Quiz into Chat without a second assessment', async ({ page, request }) => {
  test.skip(process.env.BUDDS_E2E_REAL_ADAPTIVE_CANVAS !== 'true', 'Requires intact public Canvas transport in the disposable authority stack')
  await runLearningJourney(page, request, true)
})
