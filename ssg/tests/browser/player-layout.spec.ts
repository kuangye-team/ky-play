import { importTestGames } from "./library-fixture";
import { showLibrary } from "./helpers";
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

test.beforeEach(async ({ page }) => {
  await importTestGames(page);
});

const shots = resolve(import.meta.dirname, "../../../temp/screenshot");

async function expectGameInView(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selectors = [".game-screen", ".player-toolbar"];
        return (
          selectors.every((selector) => {
            const rect = document
              .querySelector(selector)!
              .getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= innerWidth + 1 &&
              rect.bottom <= innerHeight + 1
            );
          }) && document.documentElement.scrollWidth <= innerWidth
        );
      }),
    )
    .toBe(true);
  const screen = await page.locator(".game-screen").boundingBox();
  expect(screen!.width / screen!.height).toBeCloseTo(4 / 3, 2);
}

test("Thwaite 画面与按键适应窗口，两种全屏切换保持游戏运行", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await showLibrary(page);
  await expect(page.locator(".sidebar .console-nav")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "未导入的游戏", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: `${shots}/library-thwaite.png` });
  await page
    .getByRole("button", { name: "开始 Thwaite 测试副本", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "截图", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  await expect
    .poll(
      () =>
        frame.evaluate(async () => {
          const bytes = await (
            window as any
          ).EJS_emulator.gameManager.screenshot();
          return bytes.length;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(2000);

  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 600],
    [900, 700],
    [390, 844],
    [320, 640],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator(".player-layout").evaluate((element) => {
      element.scrollTop = 0;
    });
    await expectGameInView(page);
    expect(
      await page
        .locator(".player")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    if (width > 900) {
      const tabs = await page.locator(".play-tabs").boundingBox();
      const sidebar = await page.locator(".play-sidebar").boundingBox();
      expect(sidebar!.y + sidebar!.height).toBeLessThanOrEqual(height);
      await page.locator(".play-sidebar-content").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(
        page.getByRole("button", { name: "自定义按键", exact: true }),
      ).toBeInViewport();
      expect(await page.locator(".play-tabs").boundingBox()).toEqual(tabs);
      await page.locator(".play-sidebar-content").evaluate((element) => {
        element.scrollTop = 0;
      });
    }
    if ([1440, 1280, 390, 844].includes(width))
      await page.screenshot({
        path: `${shots}/thwaite-fit-${width}x${height}.png`,
      });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  const fullscreen = page.getByRole("button", {
    name: "全屏模式",
    exact: true,
  });
  await fullscreen.click();
  await page.screenshot({ path: `${shots}/thwaite-fullscreen-menu.png` });
  await page.getByRole("menuitem", { name: "页面全屏", exact: true }).click();
  await expect(page.locator(".player-header")).toBeHidden();
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(
    true,
  );
  await expectGameInView(page);
  await page.screenshot({ path: `${shots}/thwaite-page-fullscreen.png` });

  await fullscreen.click();
  await page.getByRole("menuitem", { name: "游戏全屏", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.fullscreenElement?.classList.contains("game-screen"),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "退出游戏全屏", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/thwaite-game-fullscreen.png` });
  await page.getByRole("button", { name: "退出游戏全屏", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
  await expect(page.locator(".player-header")).toBeHidden();

  // Esc must also work after clicking the game canvas inside the iframe.
  await frame.locator("canvas").click({ position: { x: 50, y: 50 } });
  await page.keyboard.press("Escape");
  await expect(page.locator(".player-header")).toBeVisible();
  expect(page.frames()).toContain(frame);
  expect(await frame.evaluate(() => (window as any).EJS_emulator.paused)).toBe(
    false,
  );
  await expectGameInView(page);

  await fullscreen.click();
  await page.getByRole("menuitem", { name: "游戏全屏", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出游戏全屏", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
  expect(await frame.evaluate(() => (window as any).EJS_emulator.paused)).toBe(
    false,
  );
  await expectGameInView(page);
});
