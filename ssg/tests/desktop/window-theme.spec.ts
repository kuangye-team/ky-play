import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { mockDesktopStorage } from "./storage-fixture";

test("native window colors follow initial, selected and restored themes", async ({ page }) => {
  // Capture real frontend IPC; native DWM rendering requires Windows 11.
  await page.addInitScript(() => {
    Object.assign(window, {
      windowThemeCalls: [],
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" } },
        invoke: async (command: string, args: unknown) => {
          if (command.startsWith("plugin:window|") || command === "set_title_bar_color")
            (window as any).windowThemeCalls.push([command, args]);
        },
      },
    });
  });
  await mockDesktopStorage(page);
  const expectTheme = async (color: string, textColor: string, scheme: string) => {
    await expect.poll(() => page.evaluate(() =>
      (window as any).windowThemeCalls.slice(-3),
    )).toEqual([
      ["plugin:window|set_theme", { label: "main", value: scheme }],
      ["plugin:window|set_background_color", { label: "main", value: color }],
      ["set_title_bar_color", { color, textColor }],
    ]);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", color);
  };

  await page.goto("/");
  await expectTheme("#f0f4ec", "#34452e", "light");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  for (const [name, color, textColor, scheme] of [
    ["拾光紫", "#f3f6fc", "#36334d", "light"],
    ["海盐蓝", "#edf5fa", "#233e50", "light"],
    ["抹茶绿", "#f0f4ec", "#34452e", "light"],
    ["午夜", "#141622", "#eceaf6", "dark"],
  ]) {
    await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
    await expectTheme(color, textColor, scheme);
  }
  await page.getByRole("button", { name: "就用这个", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await expectTheme("#141622", "#eceaf6", "dark");
  await page.screenshot({
    path: resolve("../temp/screenshot/desktop-window-theme-midnight.png"),
    animations: "disabled",
  });
});
