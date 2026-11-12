import { importTestGames } from "./library-fixture";
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test.beforeEach(async ({ page }) => {
  await importTestGames(page);
});

test("正常游戏保存失败后仍可手动重试，再离开时自动保存", async ({ page }) => {
  await page.goto("/library");
  await page
    .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
    .click();
  const save = page.getByRole("button", { name: "保存进度", exact: true });
  await expect(save).toBeEnabled({ timeout: 45_000 });
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  await frame.evaluate(() => {
    const manager = (window as any).EJS_emulator.gameManager;
    const original = manager.getState.bind(manager);
    manager.getState = () => {
      manager.getState = original;
      throw new Error("test save failure");
    };
  });
  const back = page
    .locator(".player-header")
    .getByRole("button", { name: "返回游戏库", exact: true });
  await back.click();
  await expect(page.getByRole("status")).toContainText("进度未保存");
  await save.click();
  await expect(page.getByRole("status")).toHaveText("进度已保存");
  await expect(page.locator(".game-overlay")).toHaveCount(0);
  await back.click();
  await expect(page).toHaveURL("/library");
  expect(
    await page.evaluate(async () => {
      const { database } = await import("/src/lib/storage.ts");
      const saves = await (await database).getAll("saves");
      return {
        count: saves.length,
        automatic: saves.filter((save) => save.automatic).length,
      };
    }),
  ).toEqual({ count: 2, automatic: 1 });
});

for (const failure of ["loading", "running", "saving"]) {
  test(`${failure}：失败后可从顶部返回游戏库，不反复尝试自动保存`, async ({
    page,
  }) => {
    await page.route("**/player.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `
        const send = (type, payload = {}) => parent.postMessage({
          source: "shiguang-player", type, ...payload
        }, location.origin);
        window.saveAttempts = 0;
        addEventListener("message", (event) => {
          if (event.data.source !== "shiguang-app") return;
          if (event.data.type === "init") {
            if (${JSON.stringify(failure)} !== "loading") send("ready");
            if (${JSON.stringify(failure)} !== "saving")
              setTimeout(() => send("error", {message: "游戏没有加载成功，请重新打开。"}), 50);
          }
          if (event.data.payload?.action === "save") {
            window.saveAttempts++;
            send("response", {id: event.data.id, error: "操作没有完成，请稍后重试。"});
          }
        });
      `,
      }),
    );
    await page.goto("/library");
    await page
      .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
      .click();
    const back = page
      .locator(".player-header")
      .getByRole("button", { name: "返回游戏库", exact: true });
    if (failure === "saving") {
      await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled();
      await back.click();
      await expect(page.getByRole("status")).toContainText("进度未保存");
      await page.getByRole("button", { name: "关闭提示", exact: true }).click();
    }
    await expect(page.locator(".game-overlay h3")).toHaveText(
      "游戏暂时无法继续",
    );
    const frame = page
      .frames()
      .find((frame) => frame.url().endsWith("/player.html"))!;
    expect(await frame.evaluate(() => (window as any).saveAttempts)).toBe(
      failure === "saving" ? 1 : 0,
    );
    if (failure !== "saving") await page.keyboard.press("F6");
    expect(await frame.evaluate(() => (window as any).saveAttempts)).toBe(
      failure === "saving" ? 1 : 0,
    );
    await page.screenshot({
      path: resolve(
        import.meta.dirname,
        `../../../temp/screenshot/player-${failure}-failure.png`,
      ),
    });
    await back.click();
    await expect(page).toHaveURL("/library");
    await expect(page.locator(".player")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
  });
}
