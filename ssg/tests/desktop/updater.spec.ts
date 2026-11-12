import { mockDesktopStorage } from "./storage-fixture";
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, {
      nativeCalls: calls, nativeUpdateVersion: "1.1.0", nativeCheckError: false, nativeCheckDeferred: false,
      nativeDownloadFailures: 0, nativeCheckFailures: 0,
      __TAURI_INTERNALS__: {
      transformCallback: () => 1,
      invoke: async (command: string, args: any) => {
        calls.push(command);
        if (command === "plugin:opener|open_url") (window as any).nativeOpenedUrl = args.url;
        if (command === "plugin:app|version") return "1.0.0";
        if (command === "plugin:updater|check") {
          if ((window as any).nativeCheckDeferred)
            await new Promise<void>((resolve) => { (window as any).nativeCheckRelease = resolve; });
          if ((window as any).nativeCheckError || (window as any).nativeCheckFailures > 0) {
            (window as any).nativeCheckFailures = Math.max(0, (window as any).nativeCheckFailures - 1);
            throw "error sending request for url (https://cdn.example.com/latest.json)";
          }
          const version = (window as any).nativeUpdateVersion;
          return version ? { rid: 1, version, currentVersion: "1.0.0" } : null;
        }
        if (command === "plugin:updater|download") {
          if ((window as any).nativeDownloadError || (window as any).nativeDownloadFailures-- > 0)
            throw "error sending request for url (https://cdn.example.com/update.tar.gz)";
          return 2;
        }
        if (command === "plugin:dialog|save") return "/exports/notices.txt";
      },
    } });
  });
  await mockDesktopStorage(page);
});

test("About opens the configured download page and installs a deferred update on request", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByRole("region", { name: "应用更新" });
  await banner.getByRole("button", { name: "稍后", exact: true }).click();
  await page.getByRole("button", { name: "关于拾光", exact: true }).click();
  const about = page.getByRole("dialog", { name: "关于拾光", exact: true });
  const heading = about.locator(".modal-heading");
  await expect(heading).toContainText("当前版本v1.0.0");
  await expect(heading).toContainText("有新版本可更新");
  await expect(heading).toContainText("可更新至 v1.1.0");
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-about-update.png"), animations: "disabled" });
  await page.evaluate(() => { (window as any).nativeCheckDeferred = true; });
  await heading.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(heading.getByRole("button", { name: "正在检查更新…", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => !!(window as any).nativeCheckRelease)).toBe(true);
  await page.evaluate(() => { (window as any).nativeCheckRelease(); });
  await expect(heading.getByRole("button", { name: "检查更新", exact: true })).toBeEnabled();
  const downloadUrl = process.env.VITE_CLIENT_DOWNLOAD_URL?.trim() || "https://github.com/kuangye-team/ky-play/releases/latest";
  const download = heading.getByRole("link", { name: "前往更新", exact: true });
  await expect(download).toHaveAttribute("href", downloadUrl);
  await download.click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeOpenedUrl))
    .toBe(downloadUrl);
  await expect(about).toBeVisible();
  expect(await page.evaluate(() => (window as any).nativeCalls)).not.toContain("plugin:updater|download");
  await heading.getByRole("button", { name: "更新并重启", exact: true }).click();
  await expect(about).toHaveCount(0);
  await expect(banner).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).nativeCalls.filter((command: string) =>
    ["plugin:updater|download", "plugin:updater|install", "plugin:process|restart"].includes(command))),
  ).toEqual(["plugin:updater|download", "plugin:updater|install", "plugin:process|restart"]);
});

test("a dropped download connection retries automatically before installing", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByRole("region", { name: "应用更新" });
  await expect(banner).toBeVisible();
  await page.evaluate(() => { (window as any).nativeDownloadFailures = 1; });
  await banner.getByRole("button", { name: "更新并重启", exact: true }).click();
  await expect(banner.getByRole("button", { name: "正在更新…", exact: true })).toBeDisabled();
  await expect(banner.getByRole("button", { name: "稍后", exact: true })).toBeDisabled();
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-update-retrying.png"), animations: "disabled" });
  await expect.poll(() => page.evaluate(() => (window as any).nativeCalls)).toEqual([
    "plugin:updater|check", "plugin:updater|download", "plugin:updater|download",
    "plugin:updater|install", "plugin:process|restart",
  ]);
  await expect(banner).not.toContainText("更新暂时未完成，请重试。");
});

test("About update failures stay visible and can be retried", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByRole("region", { name: "应用更新" });
  await banner.getByRole("button", { name: "稍后", exact: true }).click();
  await page.getByRole("button", { name: "关于拾光", exact: true }).click();
  await page.evaluate(() => { (window as any).nativeDownloadError = true; });
  await page.getByRole("dialog").getByRole("button", { name: "更新并重启", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(banner).toContainText("更新暂时未完成，请重试。");
  expect(await page.evaluate(() => (window as any).nativeCalls)).not.toContain("plugin:updater|install");
  expect(await page.evaluate(() => (window as any).nativeCalls.filter((command: string) => command === "plugin:updater|download")))
    .toHaveLength(3);
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-update-download-error.png"), animations: "disabled" });
  await page.evaluate(() => { (window as any).nativeDownloadError = false; });
  await banner.getByRole("button", { name: "更新并重启", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeCalls)).toContain("plugin:process|restart");
});

test("About keeps checking through automatic retries and then shows the new version", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "应用更新" })).toBeVisible();
  await page.getByRole("button", { name: "关于拾光", exact: true }).click();
  const heading = page.getByRole("dialog").locator(".modal-heading");
  await page.evaluate(() => { Object.assign(window, { nativeCheckFailures: 2, nativeUpdateVersion: "1.2.0" }); });
  await heading.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(heading.getByRole("button", { name: "正在检查更新…", exact: true })).toBeDisabled();
  await expect(heading).not.toContainText("暂时无法检查更新，请稍后重试。");
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-about-check-retrying.png"), animations: "disabled" });
  await expect(heading).toContainText("可更新至 v1.2.0");
  await expect(heading.getByRole("button", { name: "检查更新", exact: true })).toBeEnabled();
  await expect(heading).not.toContainText("暂时无法检查更新，请稍后重试。");
  const calls = await page.evaluate(() => (window as any).nativeCalls as string[]);
  expect(calls.filter((command) => command === "plugin:updater|check")).toHaveLength(4);
  expect(calls).not.toContain("plugin:updater|download");
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-about-check-recovered.png"), animations: "disabled" });
});

test("About distinguishes up-to-date and failed checks and supports retry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "应用更新" })).toBeVisible();
  await page.getByRole("button", { name: "关于拾光", exact: true }).click();
  const heading = page.getByRole("dialog").locator(".modal-heading");
  const check = heading.getByRole("button", { name: "检查更新", exact: true });
  await page.evaluate(() => { (window as any).nativeUpdateVersion = null; });
  await check.click();
  await expect(heading).toContainText("已是最新版本");
  await expect(heading.getByRole("link", { name: "前往更新" })).toHaveCount(0);
  await expect(heading.getByRole("button", { name: "更新并重启" })).toHaveCount(0);
  await expect(heading).not.toContainText("可更新至");
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-about-latest.png"), animations: "disabled" });
  await page.evaluate(() => { (window as any).nativeCheckError = true; });
  await check.click();
  await expect(heading).toContainText("暂时无法检查更新，请稍后重试。");
  await expect(heading).not.toContainText("已是最新版本");
  await expect(check).toBeEnabled();
  expect(await page.evaluate(() => (window as any).nativeCalls.filter((command: string) => command === "plugin:updater|check")))
    .toHaveLength(5);
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-about-check-error.png"), animations: "disabled" });
  await page.evaluate(() => { Object.assign(window, { nativeCheckError: false, nativeUpdateVersion: "1.2.0" }); });
  await check.click();
  await expect(heading).toContainText("可更新至 v1.2.0");
  await expect(heading).not.toContainText("暂时无法检查更新");
});

test("About version controls fit the minimum desktop window in English", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await page.getByRole("button", { name: "切换语言", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /English/ }).click();
  await page.getByRole("button", { name: "About Oasis", exact: true }).click();
  const about = page.getByRole("dialog", { name: "About Oasis", exact: true });
  const heading = about.locator(".modal-heading");
  await expect(heading).toContainText("Current versionv1.0.0");
  await expect(heading).toContainText("Available version: v1.1.0");
  await expect(heading.getByRole("button", { name: "Check for updates", exact: true })).toBeInViewport();
  await expect(heading.getByRole("link", { name: "View update", exact: true })).toBeInViewport();
  await expect(heading.getByRole("button", { name: "Update and restart", exact: true })).toBeInViewport();
  expect(await about.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-about-english-small.png"), animations: "disabled" });
});

test("desktop updates require consent, block during imports, and restart after install", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByRole("region", { name: "应用更新" });
  await expect(banner).toBeVisible();
  await expect(page.getByRole("region", { name: "网站更新" })).toHaveCount(0);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await page.getByRole("button", { name: "从设备添加游戏", exact: true }).click();
  await expect(page.locator(".update-banner button").last()).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-update.png") });
  await banner.getByRole("button", { name: "稍后", exact: true }).click();
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).nativeCalls)).toEqual(["plugin:updater|check"]);
  await page.reload();
  await banner.getByRole("button", { name: "更新并重启" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeCalls)).toEqual([
    "plugin:updater|check", "plugin:updater|download", "plugin:updater|install", "plugin:process|restart",
  ]);
});

test("updates wait until gameplay ends without covering the player controls", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const banner = page.locator(".update-banner");
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true }).click();
  await expect(banner).toHaveCount(0);
  const save = page.getByRole("button", { name: "保存进度", exact: true });
  await expect(save).toBeEnabled({ timeout: 60_000 });

  // A background check can discover another version while the player is open.
  await page.evaluate(async () => {
    (window as any).nativeUpdateVersion = "1.2.0";
    const { checkDesktopUpdate, getAppUpdate } = await import("/src/lib/desktop-updates.ts");
    await checkDesktopUpdate();
    if (getAppUpdate().version !== "1.2.0") throw new Error("Update was not detected");
  });
  for (const [width, height] of [[1280, 720], [800, 600]]) {
    await page.setViewportSize({ width, height });
    await expect(banner).toHaveCount(0);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.getByRole("button", { name: "截图", exact: true }).click();
    const capture = page.getByRole("dialog", { name: "游戏截图", exact: true });
    await expect(capture).toBeVisible();
    await capture.getByRole("button", { name: "关闭", exact: true }).click();
    await page.screenshot({ path: resolve(`../temp/screenshot/update-player-${width}x${height}.png`) });
  }
  await save.click();
  await expect(page.locator(".toast")).toContainText("进度已保存");
  await page.getByRole("button", { name: "返回游戏库", exact: true }).click();
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "更新并重启", exact: true })).toBeEnabled();
  await page.screenshot({ path: resolve("../temp/screenshot/update-after-playing.png") });
  await banner.getByRole("button", { name: "稍后", exact: true }).click();
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).nativeCalls)).not.toContain("plugin:updater|download");
});

test("desktop hash routes survive reload and licenses export through the native save dialog", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.getByRole("heading", { name: "开源许可", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "许可全文", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toContainText("Thwaite");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("link", { name: "下载全部许可说明" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeCalls)).toContain("plugin:fs|write_file");
  await page.screenshot({ path: resolve("../temp/screenshot/desktop-licenses.png") });
});
