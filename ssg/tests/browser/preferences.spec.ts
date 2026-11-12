import { importTestGames } from "./library-fixture";
import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const shots = resolve(import.meta.dirname, "../../../temp/screenshot");
const key = "shiguang.preferences";
const switchToEnglish = async (page: Page) => {
  await page.getByRole("button", { name: "切换语言", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /English/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
};

test("语言菜单支持键盘操作，英文覆盖各页面并在刷新后保留", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "切换语言" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(3);
  await expect(
    page.getByRole("menuitemradio", { name: "系统 系统默认", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.screenshot({
    path: `${shots}/language-menu.png`,
    animations: "disabled",
  });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Change language" }),
  ).toBeFocused();
  await expect(page).toHaveTitle("Oasis · Osmanthus wine, and days with old friends");
  for (const [path, title] of [
    ["library", "Game library"],
    ["recent", "Recently played"],
    ["favorites", "Favorites"],
    ["saves", "My saves"],
    ["tags", "Tags"],
    ["controls", "Controllers & keys"],
    ["storage", "Storage"],
    ["about", "Open-source licenses"],
    ["privacy", "Privacy"],
  ]) {
    await page.goto(`/${path}`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: new RegExp(title),
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${title} · Oasis`);
  }
  await page.goto("/library");
  await page.getByRole("button", { name: "Sort by", exact: true }).click();
  await expect(
    page.getByRole("menuitemradio", { name: /Newest games first/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("combobox")).toHaveAttribute(
    "placeholder",
    "What would you like to play?",
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("menuitemradio", { name: /中文/ }).click();
  await expect(page).toHaveTitle("游戏库 · 拾光");
  expect(errors).toEqual([]);
});

test("四个主题即时生效，弹窗可关闭且保留选择", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "切换主题" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("group", { name: "选择主题" }).getByRole("button"),
  ).toHaveCount(4);
  await page.screenshot({
    path: `${shots}/theme-picker-zh.png`,
    animations: "disabled",
  });
  const backgrounds = new Set<string>();
  for (const [theme, name] of [
    ["violet", "拾光紫"],
    ["ocean", "海盐蓝"],
    ["matcha", "抹茶绿"],
    ["midnight", "午夜"],
  ]) {
    await dialog.getByRole("button", { name, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      dialog.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator('[aria-pressed="true"]')).toHaveCount(1);
    backgrounds.add(
      await page
        .locator("html")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "切换主题" })).toBeFocused();
    await page.screenshot({
      path: `${shots}/theme-${theme}.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "切换主题" }).click();
  }
  expect(backgrounds.size).toBe(4);
  await page.screenshot({
    path: `${shots}/theme-picker-midnight.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "就用这个" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await switchToEnglish(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.getByRole("button", { name: "Change theme" }).click();
  await expect(
    page.getByRole("button", { name: "Midnight", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: `${shots}/theme-picker-en.png`,
    animations: "disabled",
  });
});

test("跟随系统响应浏览器语言变化，手动选择优先", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  const changeSystem = async (language: string) =>
    page.evaluate((language) => {
      Object.defineProperty(navigator, "languages", {
        configurable: true,
        value: [language],
      });
      Object.defineProperty(navigator, "language", {
        configurable: true,
        value: language,
      });
      window.dispatchEvent(new Event("languagechange"));
    }, language);
  await changeSystem("en-US");
  await expect(page).toHaveTitle("Oasis · Osmanthus wine, and days with old friends");
  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("menuitemradio", { name: /中文/ }).click();
  await changeSystem("fr-FR");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("button", { name: "切换语言" }).click();
  await page.getByRole("menuitemradio", { name: "系统 系统默认", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await changeSystem("zh-TW");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("手机与平板上语言菜单和主题弹窗均可操作", async ({ page }) => {
  await page.goto("/");
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ["切换语言", "切换主题", "关于拾光"]) {
      const bounds = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await page.getByRole("button", { name: "切换语言" }).click();
    await expect(
      page.getByRole("menuitemradio", { name: /English/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "切换主题" }).click();
    await expect(
      page.getByRole("button", { name: "午夜", exact: true }),
    ).toBeVisible();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `${shots}/theme-picker-${width}.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "海盐蓝", exact: true }).click();
    await page.getByRole("button", { name: "就用这个" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await switchToEnglish(page);
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.screenshot({
    path: `${shots}/theme-picker-mobile-en.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Looks good" }).click();
  await page.screenshot({
    path: `${shots}/preferences-mobile-en.png`,
    animations: "disabled",
  });
});

test("存储不可用或偏好损坏时，切换仍然可用", async ({ page }) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "invalid json"),
    key,
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "matcha");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Unavailable", "SecurityError");
    };
  });
  await switchToEnglish(page);
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("button", { name: "Daydream", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "violet");
});

test("同一浏览器的页面同步语言和主题", async ({ page, context }) => {
  await page.goto("/");
  const second = await context.newPage();
  await second.goto("/library");
  await switchToEnglish(page);
  await expect(second).toHaveTitle("Game library · Oasis");
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("button", { name: "Daydream", exact: true }).click();
  await expect(second.locator("html")).toHaveAttribute("data-theme", "violet");
  await second.close();
});

test("英文游玩界面使用英文菜单、按键和加载提示", async ({ page }) => {
  await importTestGames(page);
  await page.goto("/library");
  await switchToEnglish(page);
  await page
    .getByRole("button", { name: "Play 小镇反弹道导弹", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save progress", exact: true }),
  ).toBeEnabled({ timeout: 45_000 });
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  expect(await frame.evaluate(() => (window as any).EJS_language)).toBe("en-US");
  await expect(page.locator(".play-sidebar")).toContainText("Right Shift");
  await page
    .getByRole("button", { name: "Back to library", exact: true })
    .click();
  await expect(page).toHaveURL("/library");
});
