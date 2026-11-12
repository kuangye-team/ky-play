import { importTestGames } from "./library-fixture";
import { showLibrary, waitForPicture } from "./helpers";
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await importTestGames(page);
});

const shots = resolve(import.meta.dirname, "../../../temp/screenshot");

test("快捷键在页面与游戏画面内可用，弹窗和长按不会重复保存", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await showLibrary(page);
  await page
    .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
    .click();
  const capture = page.getByRole("button", { name: "截图", exact: true });
  const save = page.getByRole("button", { name: "保存进度", exact: true });
  await expect(capture).toBeEnabled({ timeout: 45_000 });
  const frame = page
    .frames()
    .find((item) => item.url().endsWith("/player.html"))!;
  await waitForPicture(frame);
  const countSaves = () =>
    page.evaluate(async () => {
      const { database } = await import("/src/lib/storage.ts");
      return (await (await database).getAll("saves")).length;
    });
  const isPaused = () =>
    frame.evaluate(() => (window as any).EJS_emulator.paused);
  await expect(page.locator(".play-tip")).toHaveCount(0);
  await expect(page.locator(".player-save-note")).toHaveCount(0);
  await page
    .locator(".play-tabs")
    .getByRole("button", { name: "我的存档", exact: true })
    .click();
  await expect(page.locator(".player-save-note")).toHaveText(/自动保存/);
  await page
    .locator(".play-tabs")
    .getByRole("button", { name: "外设设置", exact: true })
    .click();
  await expect(page.locator(".player-save-note")).toHaveCount(0);
  await expect(capture).toHaveAttribute("aria-keyshortcuts", "F8");
  await expect(save).toHaveAttribute("aria-keyshortcuts", "F6");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const a = (await capture.boundingBox())!;
    const b = (await save.boundingBox())!;
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    await page.screenshot({ path: `${shots}/player-actions-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".player").focus();
  await page.keyboard.press("F8");
  const preview = page.getByRole("dialog", { name: "游戏截图", exact: true });
  await expect(
    preview.getByRole("img", { name: "小镇反弹道导弹 截图", exact: true }),
  ).toBeVisible();
  await expect.poll(isPaused).toBe(true);
  await page.keyboard.press("F6");
  expect(await countSaves()).toBe(0);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await page.locator(".player").focus();
  await page.keyboard.down("F6");
  await expect.poll(countSaves).toBe(1);
  await expect(save).toBeEnabled();
  // A held key can keep firing after saving finishes; it must still save only once.
  await page.keyboard.down("F6");
  await page.keyboard.up("F6");
  await expect(save).toBeEnabled();
  expect(await countSaves()).toBe(1);

  await frame.locator("canvas").click();
  await page.keyboard.press("F6");
  await expect.poll(countSaves).toBe(2);
  await expect(save).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect.poll(isPaused).toBe(true);
  await page.keyboard.press("F8");
  await expect(
    preview.getByRole("img", { name: "小镇反弹道导弹 截图", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect.poll(isPaused).toBe(true);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect.poll(isPaused).toBe(false);

  await page.getByRole("button", { name: "全屏模式", exact: true }).click();
  await page.getByRole("menuitem", { name: "游戏全屏", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await frame.locator("canvas").click();
  await page.keyboard.press("F8");
  await expect(
    preview.getByRole("img", { name: "小镇反弹道导弹 截图", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "自定义按键", exact: true }).click();
  await page
    .locator(".binding-grid")
    .getByRole("button", { name: /A · 跳跃/ })
    .click();
  await page.keyboard.press("F6");
  await expect(page.locator(".binding-status")).toContainText(
    "已用于「保存进度」",
  );
  await page.keyboard.press("F8");
  await expect(page.locator(".binding-status")).toContainText("已用于「截图」");
  expect(await countSaves()).toBe(2);
  await expect(preview).toHaveCount(0);
});

for (const [id, name] of [
  ["thwaite-test", "小镇反弹道导弹"],
  ["thwaite-copy", "Thwaite 测试副本"],
]) {
  test(`${name}：截图可下载、设为封面并在刷新后保留`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await showLibrary(page);
    await page
      .getByRole("button", { name: `开始 ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "截图", exact: true }),
    ).toBeEnabled({ timeout: 45_000 });
    const frame = page
      .frames()
      .find((frame) => frame.url().endsWith("/player.html"))!;
    const isPaused = () =>
      frame.evaluate(() => (window as any).EJS_emulator.paused);
    const capture = page.getByRole("button", { name: "截图", exact: true });

    await waitForPicture(frame);

    await capture.click();
    const preview = page.getByRole("dialog", { name: "游戏截图", exact: true });
    const image = preview.getByRole("img", { name: `${name} 截图` });
    await expect(image).toBeVisible();
    await expect.poll(isPaused).toBe(true);
    const cover = await image.getAttribute("src");
    expect(cover).toMatch(/^data:image\/png;base64,/);
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => {
          if (!element.complete || !element.naturalWidth) return 0;
          const canvas = document.createElement("canvas");
          canvas.width = element.naturalWidth;
          canvas.height = element.naturalHeight;
          const context = canvas.getContext("2d")!;
          context.drawImage(element, 0, 0);
          const data = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          return new Set(new Uint32Array(data.buffer)).size;
        }),
      )
      .toBeGreaterThan(3);
    await page.screenshot({
      path: `${shots}/${id}-screenshot-preview.png`,
      animations: "disabled",
    });

    const downloading = page.waitForEvent("download");
    await preview
      .getByRole("button", { name: "下载图片", exact: true })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^${name}-\\d+\\.png$`),
    );
    const bytes = await readFile((await download.path())!);
    expect(bytes.equals(Buffer.from(cover!.split(",")[1], "base64"))).toBe(
      true,
    );
    await preview
      .getByRole("button", { name: "设为封面", exact: true })
      .click();
    await expect(
      preview.getByRole("button", { name: "已设为封面", exact: true }),
    ).toBeDisabled();
    await preview.getByRole("button", { name: "关闭", exact: true }).click();
    await expect.poll(isPaused).toBe(false);

    // Capturing an already paused game must preserve its paused state.
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect.poll(isPaused).toBe(true);
    await capture.click();
    await expect(image).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect.poll(isPaused).toBe(true);
    await expect(
      page.getByRole("button", { name: "继续", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "返回游戏库", exact: true }).click();
    await expect(page).toHaveURL("/library");
    await expect(
      page.getByRole("img", { name: `${name} 游戏封面`, exact: true }),
    ).toHaveAttribute("src", cover!);
    await page.reload();
    await showLibrary(page);
    await expect(
      page.getByRole("img", { name: `${name} 游戏封面`, exact: true }),
    ).toHaveAttribute("src", cover!);
    await page.screenshot({ path: `${shots}/${id}-screenshot-cover.png` });
    expect(
      errors.filter(
        (message) => message !== "Wake Lock permission request denied",
      ),
    ).toEqual([]);
  });
}

test("截图失败后可以重试，手机预览和工具栏不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await showLibrary(page);
  await page
    .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "截图", exact: true }),
  ).toBeEnabled({ timeout: 45_000 });
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  await waitForPicture(frame);
  await frame.evaluate(() => {
    const manager = (window as any).EJS_emulator.gameManager;
    const original = manager.screenshot.bind(manager);
    manager.screenshot = () => {
      manager.screenshot = original;
      return Promise.reject(new Error("test screenshot failure"));
    };
  });
  await page.getByRole("button", { name: "截图", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/截图没有完成/);
  await expect(
    page.getByRole("button", { name: "截图", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "关闭提示", exact: true }).click();
  await page.screenshot({ path: `${shots}/screenshot-toolbar-mobile.png` });
  await page.getByRole("button", { name: "截图", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "游戏截图", exact: true });
  await expect(
    preview.getByRole("img", { name: "小镇反弹道导弹 截图" }),
  ).toBeVisible();
  await page.screenshot({
    path: `${shots}/screenshot-preview-mobile.png`,
    animations: "disabled",
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await preview.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".player")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page.locator(".player-toolbar").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return Array.from(element.children).every((child) => {
          const rect = child.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right;
        });
      }),
    ).toBe(true);
  }
});

test("只有 main-panel 随内容滚动，顶部和侧栏保持原位", async ({ page }) => {
  await page.goto("/");
  await showLibrary(page);
  await expect(page.getByRole("heading", { name: "小镇反弹道导弹" })).toBeVisible();
  await page.evaluate(async () => {
    const { database } = await import("/src/lib/storage.ts");
    const db = await database;
    const thwaite = (await db.get("games", "thwaite-test"))!;
    for (let i = 0; i < 20; i++)
      await db.put("games", {
        ...thwaite,
        id: `scroll-${i}`,
        name: `回忆 ${i + 1}`,
      });
  });
  await page.reload();
  await showLibrary(page);
  for (const width of [1440, 1600, 900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const panel = page.locator(".main-panel");
    await panel.evaluate((element) => {
      element.scrollTop = 0;
    });
    const headerBefore = await page.locator(".topbar").boundingBox();
    const sidebarBefore = await page.locator(".sidebar").boundingBox();
    await panel.hover();
    await page.mouse.wheel(0, 1400);
    await expect
      .poll(() => panel.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect(await page.locator(".topbar").boundingBox()).toEqual(headerBefore);
    expect(await page.locator(".sidebar").boundingBox()).toEqual(sidebarBefore);
    expect(
      await page.evaluate(() => ({
        top: window.scrollY,
        overflowX: document.documentElement.scrollWidth > innerWidth,
        overflowY: document.documentElement.scrollHeight > innerHeight,
      })),
    ).toEqual({ top: 0, overflowX: false, overflowY: false });
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: `${shots}/main-panel-scroll-${width}.png`,
      });
  }
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.getByRole("link", { name: "存储管理", exact: true }).click();
  await expect
    .poll(() =>
      page.locator(".main-panel").evaluate((element) => element.scrollTop),
    )
    .toBe(0);
  await expect(
    page.getByRole("heading", { name: "存储管理", exact: true }),
  ).toBeVisible();
});
