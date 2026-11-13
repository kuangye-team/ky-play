import { expect, test } from "@playwright/test";

const releaseURL = process.env.VITE_API_LATEST || "https://github.com/kuangye-team/ky-play/releases/latest/download/latest.json";

const release = {
  version: "1.2.3",
  platforms: {
    "darwin-aarch64": { signature: "signature", url: "https://example.com/ky-play-1.2.3-universal.app.tar.gz" },
    "darwin-x86_64": { signature: "signature", url: "https://example.com/ky-play-1.2.3-universal.app.tar.gz" },
    "windows-x86_64": { signature: "signature", url: "https://example.com/ky-play-1.2.3-x64-setup.exe" },
  },
};

test("HTTP 更新清单中的本地客户端下载地址可正常显示", async ({ page }) => {
  const base = "http://host.docker.internal:10888/play";
  await page.route(releaseURL, (route) => route.fulfill({ json: {
    ...release,
    platforms: Object.fromEntries(Object.entries(release.platforms).map(([platform, entry]) => [
      platform, { ...entry, url: entry.url.replace("https://example.com", base) },
    ])),
  } }));
  await page.goto("/");
  await page.getByRole("button", { name: "打开客户端", exact: true }).hover();
  const panel = page.getByRole("dialog", { name: "下载拾光客户端" });
  await expect(panel.getByText("v1.2.3")).toBeVisible();
  await expect(panel.getByRole("link", { name: /Windows 10/ })).toHaveAttribute("href", `${base}/ky-play-1.2.3-x64-setup.exe`);
  await expect(panel.getByRole("link", { name: /macOS/ })).toHaveAttribute("href", `${base}/ky-play-1.2.3-universal.dmg`);
  await page.screenshot({ path: "../temp/screenshot/client-access-http.png", fullPage: true });
});

test("客户端入口按系统推荐下载，悬浮区可进入，键盘与关闭行为正常", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "Win32" });
    Object.defineProperty(navigator, "userAgentData", { value: { platform: "Windows" } });
  });
  let requests = 0;
  await page.route(releaseURL, (route) => { requests++; return route.fulfill({ json: release }); });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "打开客户端", exact: true });
  const panel = page.getByRole("dialog", { name: "下载拾光客户端" });
  await expect(trigger).toBeVisible();
  expect(requests).toBe(0);
  await expect(trigger.locator("xpath=following-sibling::*[1]")).toHaveClass(/about-trigger/);
  await trigger.hover();
  await expect(panel.getByText("v1.2.3")).toBeVisible();
  const windows = panel.getByRole("link", { name: /Windows 10/ });
  await expect(windows).toHaveClass(/recommended/);
  await expect(windows.locator("small")).toHaveText("Windows 10 / 11");
  await expect(panel.getByRole("link", { name: "查看所有下载" })).toHaveAttribute("href", "https://github.com/kuangye-team/ky-play/releases/latest");
  await expect(windows).toHaveAttribute("href", /setup\.exe$/);
  await expect(panel.getByRole("link", { name: /macOS/ })).toHaveAttribute("href", /universal\.dmg$/);
  await windows.hover();
  await page.waitForTimeout(250);
  await expect(panel).toBeVisible();
  await page.screenshot({ path: "../temp/screenshot/client-access-windows.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await trigger.focus();
  await expect(panel).toBeVisible();
  await trigger.press("ArrowDown");
  await expect(windows).toBeFocused();
  await page.getByRole("button", { name: "关于拾光", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("dialog", { name: "关于拾光" })).toBeVisible();
  expect(requests).toBe(1);
});

test("下载失败可重试，手机可点击查看下载且不会横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "iPhone" });
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" });
  });
  let requests = 0;
  await page.route(releaseURL, (route) => ++requests === 1 ? route.fulfill({ status: 503 }) : route.fulfill({ json: release }));
  await page.goto("/");
  await page.getByRole("button", { name: "打开客户端", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "下载拾光客户端" });
  await expect(panel.getByRole("alert")).toContainText("下载地址暂时无法获取");
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await expect(panel.getByText("v1.2.3")).toBeVisible();
  await expect(panel.getByText("适合此设备")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../temp/screenshot/client-access-mobile.png", fullPage: true });
});

test("macOS launches the client and keeps the download fallback available in English and dark mode", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("shiguang.preferences", JSON.stringify({ language: "en", theme: "midnight" }));
    Object.defineProperty(navigator, "platform", { value: "MacIntel" });
    Object.defineProperty(navigator, "userAgentData", { value: { platform: "macOS" } });
  });
  await page.route(releaseURL, (route) => route.fulfill({ json: release }));
  const protocolRequests: string[] = [];
  const session = await page.context().newCDPSession(page);
  await session.send("Page.enable");
  session.on("Page.frameRequestedNavigation", (event) => protocolRequests.push(event.url));
  await page.goto("/");
  await page.getByRole("button", { name: "Open desktop app", exact: true }).click();
  await expect.poll(() => protocolRequests).toContain("ky-play://open");
  const panel = page.getByRole("dialog", { name: "Download Oasis" });
  await expect(panel.getByRole("link", { name: /macOS/ })).toHaveClass(/recommended/);
  await expect(panel).toContainText("If the app did not open, download and install it first.");
  await page.screenshot({ path: "../temp/screenshot/client-access-macos-dark.png", fullPage: true });
});
