import { expect, test } from "@playwright/test";

// BC-01 smoke test: proves the screen-test tool chain and the test-hook convention (TR-9) work.
// Real screens arrive with BC-13; until then this page is a stand-in for one.
const PAGE = `
  <main dir="rtl" lang="ur">
    <button data-testid="shell.smoke.press" onclick="document.querySelector('[data-testid=&quot;shell.smoke.result&quot;]').textContent = 'pressed'">Press</button>
    <output data-testid="shell.smoke.result">idle</output>
    <input data-testid="shell.smoke.name" />
  </main>`;

test("finds controls by test hook and drives them with keyboard and click", async ({ page }) => {
  await page.setContent(PAGE);
  await expect(page.getByTestId("shell.smoke.result")).toHaveText("idle");
  await page.getByTestId("shell.smoke.name").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("shell.smoke.press")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("shell.smoke.result")).toHaveText("pressed");
});

test("test mode switches animations off", async ({ page }) => {
  await page.setContent(PAGE);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
});
