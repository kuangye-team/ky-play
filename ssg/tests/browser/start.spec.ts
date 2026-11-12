import { importTestGames } from "./library-fixture";
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import { showLibrary } from "./helpers";
test.beforeEach(async ({ page }) => {
  await importTestGames(page);
});

const shots = resolve(import.meta.dirname, "../../../temp/screenshot");

test("开始页的三个位置可选择、替换、清空，刷新和删除游戏后保持正确", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "开始", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".quick-slots .quick-slot")).toHaveCount(3);
  await expect(page.locator(".welcome-banner")).toBeVisible();
  await page.getByRole("button", { name: "选择位置 1 的游戏" }).click();
  await page.getByLabel("搜索常玩游戏").fill("小镇");
  await page.locator(".slot-choice").filter({ hasText: "小镇反弹道导弹" }).click();
  await page.getByRole("button", { name: "选择位置 2 的游戏" }).click();
  await expect(
    page.locator(".slot-choice").filter({ hasText: "小镇反弹道导弹" }),
  ).toBeDisabled();
  await page.locator(".slot-choice").filter({ hasText: "Thwaite 测试副本" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".slot-count")).toHaveText("2 / 3");
  await expect(page.getByRole("article", { name: "常玩位置 1" })).toContainText(
    "小镇反弹道导弹",
  );
  await page.screenshot({
    path: `${shots}/start-desktop.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "更换位置 1 的游戏" }).click();
  await page.getByRole("button", { name: "清空这个位置" }).click();
  await page.getByRole("button", { name: "更换位置 2 的游戏" }).click();
  await page.locator(".slot-choice").filter({ hasText: "小镇反弹道导弹" }).click();
  await expect(page.getByRole("article", { name: "常玩位置 2" })).toContainText(
    "小镇反弹道导弹",
  );
  await page.getByRole("button", { name: "选择位置 1 的游戏" }).click();
  await page.locator(".slot-choice").filter({ hasText: "Thwaite 测试副本" }).click();
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page
      .locator(".main-panel")
      .evaluate((element) => (element.scrollTop = 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".main-panel")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    if (width === 390) {
      await page.screenshot({
        path: `${shots}/start-mobile.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "更换位置 2 的游戏" }).click();
      await page.screenshot({
        path: `${shots}/start-picker-mobile.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page
        .locator(".main-panel")
        .evaluate((element) => (element.scrollTop = element.scrollHeight));
      await page.screenshot({
        path: `${shots}/start-mobile-recent.png`,
        animations: "disabled",
      });
    }
  }
  await page.evaluate(async () => {
    const { deleteGame } = await import("/src/lib/storage.ts");
    await deleteGame("thwaite-test");
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "选择位置 2 的游戏" }),
  ).toBeVisible();
});

test("快速开始保留最近三个不同游戏，启动更新顺序并能恢复存档", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".quick-slots .quick-slot")).toHaveCount(3);
  await page.evaluate(async () => {
    const { database } = await import("/src/lib/storage.ts");
    const db = await database;
    const thwaite = (await db.get("games", "thwaite-test"))!;
    const rom = (await db.get("roms", "thwaite-test"))!;
    for (let i = 1; i <= 4; i++) {
      await db.put("games", {
        ...thwaite,
        id: `recent-${i}`,
        name: `冒险 ${i}`,
        lastPlayed: Date.now() - i * 1000,
      });
      await db.put("roms", rom, `recent-${i}`);
    }
  });
  await page.reload();
  await expect(page.locator(".recent-game")).toHaveCount(3);
  await expect(page.locator(".recent-game .slot-info strong")).toHaveText([
    "冒险 1",
    "冒险 2",
    "冒险 3",
  ]);
  await showLibrary(page);
  await page.getByRole("button", { name: "开始 冒险 4", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled({
    timeout: 45000,
  });
  await page.getByRole("button", { name: "保存进度", exact: true }).click();
  await expect(page.getByText("进度已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回游戏库", exact: true }).click();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "开始", exact: true })
    .click();
  await expect(page.locator(".recent-game .slot-info strong")).toHaveText([
    "冒险 4",
    "冒险 1",
    "冒险 2",
  ]);
  await expect(page.locator(".recent-game").first()).toContainText("继续游戏");
  await page.reload();
  await expect(page.locator(".recent-game .slot-info strong")).toHaveText([
    "冒险 4",
    "冒险 1",
    "冒险 2",
  ]);
  await page
    .getByRole("button", { name: "快速开始 冒险 4", exact: true })
    .click();
  await expect(page.getByText("已恢复游戏进度", { exact: true })).toBeVisible({
    timeout: 45000,
  });
});

test("平台和标签组合筛选，新增格式导入、按键和 PSP 资源齐备", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await showLibrary(page);
  await expect(page.locator(".welcome-banner")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "游戏类型" })).toHaveCount(0);
  const platforms = page.getByRole("group", { name: "游戏平台", exact: true });
  await expect(platforms.getByRole("button")).toHaveCount(14);
  await platforms.getByRole("button", { name: "NES", exact: true }).click();
  await page.getByRole("button", { name: "挑战通关", exact: true }).click();
  await expect(page.locator(".game-card")).toHaveCount(1);
  await expect(page.locator(".game-card")).toContainText("小镇反弹道导弹");
  await page.getByRole("button", { name: "轻松一下", exact: true }).click();
  await expect(page.locator(".game-card")).toHaveCount(1);
  await expect(page.locator(".game-card")).toContainText("Thwaite 测试副本");
  await page
    .getByRole("button", { name: "从设备添加游戏", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: /游戏所属平台/ }),
  ).toHaveCount(0);
  const iso = Buffer.alloc(65536);
  iso.set([1, 67, 68, 48, 48, 49, 1], 0x8000);
  iso.write("PSP GAME", 0x8008);
  const psx = Buffer.from(iso);
  psx.fill(0, 0x8008, 0x8028);
  psx.write("PLAYSTATION", 0x8008);
  await page.screenshot({
    path: `${shots}/upload-desktop.png`,
    animations: "disabled",
  });
  const arcade = Buffer.from(
    zipSync({ "chip.bin": new Uint8Array([1, 2, 3]) }),
  );
  await page.getByLabel("选择游戏文件").setInputFiles([
    {
      name: "掌上冒险.iso",
      mimeType: "application/octet-stream",
      buffer: iso,
    },
    {
      name: "光盘冒险.iso",
      mimeType: "application/octet-stream",
      buffer: psx,
    },
    {
      name: "掌上旅行.cso",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(4096, 6),
    },
    {
      name: "swan.ws",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(512, 7),
    },
    {
      name: "color.wsc",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(512, 8),
    },
    { name: "arcade.zip", mimeType: "application/zip", buffer: arcade },
  ]);
  await expect(page.locator(".upload-results .success")).toHaveCount(6);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page
        .locator(".upload-modal")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `${shots}/upload-mobile-${width}.png`,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "去游戏库看看" }).click();
  await platforms.getByRole("button", { name: "PSP", exact: true }).click();
  await expect(page.locator(".game-card")).toHaveCount(2);
  await platforms.getByRole("button", { name: "PSX", exact: true }).click();
  await expect(page.locator(".game-card")).toHaveCount(1);
  await platforms
    .getByRole("button", { name: "所有平台", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${shots}/library-filters-mobile.png`,
    animations: "disabled",
  });
  expect(
    await page
      .locator(".main-panel")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("link", { name: "外设设置", exact: true }).click();
  for (const [system, button] of [
    ["PSP", "摇杆 ↑"],
    ["Arcade", "投币"],
    ["WS", "Y ↑"],
    ["WSC", "Y →"],
  ]) {
    await page
      .getByRole("group", { name: "选择平台", exact: true })
      .getByRole("button", { name: system, exact: true })
      .click();
    await expect(page.locator(".binding-grid")).toContainText(button);
  }
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  for (const url of [
    "/player.html",
    "http://127.0.0.1:4174/lib/emulatorjs/4.2.3/data/cores/ppsspp-assets.zip",
    "http://127.0.0.1:4174/lib/emulatorjs/4.2.3/data/cores/ppsspp-thread-wasm.data",
  ]) {
    const response = await request.get(url);
    expect(response.ok()).toBe(true);
    if (url === "/player.html")
      expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
    else
      expect(response.headers()["access-control-allow-origin"]).toBe("*");
  }
});
