import { expect, type Page } from '@playwright/test'

export async function waitForView(page: Page, testId: string, timeout = 120_000) {
  await expect(page.getByTestId(testId)).toBeVisible({ timeout })
}
