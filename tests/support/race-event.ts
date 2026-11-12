import { expect, type Page } from "@playwright/test";

export async function startEvent(page: Page): Promise<void> {
  await expect(page.locator(".ev-circuits")).toBeVisible();
  await page.locator("[data-event=next]").click();
  await expect(page.locator(".ev-conditions")).toBeVisible();
  await page.locator("[data-event=next]").click();
  await expect(page.locator(".ev-settings")).toBeVisible();
  await page.locator("[data-event=start]").click();
}
