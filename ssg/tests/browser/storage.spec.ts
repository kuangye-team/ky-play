import { importTestGames } from "./library-fixture";
import { showLibrary } from "./helpers";
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { statSync } from "node:fs";
const fixtureBytes = statSync(resolve(import.meta.dirname, "../../public/game/thwaite.nes")).size;
const withGames = (megabytes: number) => `${(megabytes + fixtureBytes * 2 / 1024 ** 2).toFixed(1)} MB`;
test.beforeEach(async ({ page }) => {
  await importTestGames(page);
});

const shots = resolve(import.meta.dirname, "../../../temp/screenshot");

test("新平台、游戏容量、真实 NES 启动和存档", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await showLibrary(page);
  await expect(page.getByRole("heading", { name: "小镇反弹道导弹" })).toBeVisible();
  await expect(page.getByLabel(`游戏大小 ${(fixtureBytes / 1024).toFixed(0)} KB`).first()).toBeVisible();
  for (const system of [
    "MD",
    "GBC",
    "PSX",
    "PSP",
    "Arcade",
    "WS",
    "WSC",
    "NDS",
    "N64",
  ])
    await expect(
      page
        .getByRole("group", { name: "游戏平台" })
        .getByRole("button", { name: system, exact: true }),
    ).toBeVisible();
  await page
    .getByRole("group", { name: "游戏平台" })
    .getByRole("button", { name: "NDS", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Thwaite 测试副本", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "小镇反弹道导弹", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "所有平台", exact: true }).click();
  await page.screenshot({
    path: `${shots}/library-platforms-size.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled({
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "保存进度", exact: true }).click();
  await expect(
    page.getByText("进度已保存", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${shots}/thwaite-test-platform-regression.png`,
    fullPage: true,
  });
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  expect(
    await frame.evaluate(() =>
      (window as any).EJS_emulator.gameManager.getSaveFilePath(),
    ),
  ).toContain("/data/saves/thwaite-test/");
  await page.getByRole("button", { name: "返回游戏库", exact: true }).click();
  await page.getByRole("link", { name: "存储管理", exact: true }).click();
  await expect(page.locator(".storage-total")).not.toHaveText("0 B");
  await expect(page.getByText("冒险进度 1", { exact: true })).toBeVisible();
  await expect(page.getByText("离开时的进度", { exact: true })).toBeVisible();
  expect(
    errors.filter(
      (message) => message !== "Wake Lock permission request denied",
    ),
  ).toEqual([]);
});

test("存储统计、筛选、确认和批量清理", async ({ page }) => {
  await page.goto("/");
  await showLibrary(page);
  await expect(page.getByRole("heading", { name: "小镇反弹道导弹" })).toBeVisible();
  await page.evaluate(async () => {
    const { database } = await import("/src/lib/storage.ts");
    const db = await database;
    const now = Date.now();
    for (const [id, name, system, size] of [
      ["demo-psx", "星际冒险", "psx", 48 * 1024 ** 2],
      ["demo-nds", "口袋花园", "nds", 16 * 1024 ** 2],
      ["demo-md", "极速街道", "md", 2 * 1024 ** 2],
    ] as const) {
      await db.put("games", {
        id,
        name,
        system,
        filename: `${id}.${system === "psx" ? "chd" : system}`,
        tags: [],
        favorite: false,
        added: now,
        playSeconds: 0,
        hash: id,
        size,
      });
      await db.put("roms", new Blob([new Uint8Array(size)]), id);
    }
    await db.put("saves", {
      id: "demo-auto",
      name: "离开时的进度",
      gameId: "demo-psx",
      created: now,
      automatic: true,
      data: new Blob([new Uint8Array(3 * 1024 ** 2)]),
    });
    await db.put("saves", {
      id: "demo-manual",
      name: "花园的第一天",
      gameId: "demo-nds",
      created: now,
      data: new Blob([new Uint8Array(512 * 1024)]),
    });
  });
  await page.reload();
  await showLibrary(page);
  await page.getByRole("link", { name: "存储管理", exact: true }).click();
  await expect(page.locator(".storage-total")).toHaveText(withGames(69.5));
  await page.screenshot({
    path: `${shots}/storage-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "大文件", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("星际冒险");
  await page
    .getByRole("checkbox", { name: "选择 星际冒险", exact: true })
    .check();
  await page.getByRole("button", { name: "清理所选", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("51.0 MB");
  await expect(page.getByRole("dialog")).toContainText("离开时的进度");
  await page.screenshot({
    path: `${shots}/storage-cleanup-confirm.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "再想想", exact: true }).click();
  await expect(page.locator(".storage-total")).toHaveText(withGames(69.5));
  await page.getByRole("button", { name: "清理所选", exact: true }).click();
  await page.getByRole("button", { name: "确认清理", exact: true }).click();
  await expect(page.locator(".storage-total")).toHaveText(withGames(18.5));
  await page.getByRole("button", { name: "全部文件", exact: true }).click();
  await expect(page.locator("tbody")).not.toContainText("星际冒险");
  await expect(page.locator("tbody")).toContainText("花园的第一天");
  await page.reload();
  await showLibrary(page);
  await page.getByRole("link", { name: "存储管理", exact: true }).click();
  await expect(page.locator(".storage-total")).toHaveText(withGames(18.5));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${shots}/storage-mobile.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("新平台导入和按键页面支持手机布局", async ({ page }) => {
  await page.goto("/");
  await showLibrary(page);
  await page
    .getByRole("button", { name: "从设备添加游戏", exact: true })
    .first()
    .click();
  const nds = Buffer.alloc(1024);
  nds[0] = 1;
  const md = Buffer.alloc(1024);
  md.write("SEGA MEGA DRIVE", 256);
  const n64 = Buffer.alloc(4096);
  n64.set([128, 55, 18, 64]);
  const gbc = Buffer.alloc(1024);
  gbc[0] = 2;
  const psx = Buffer.alloc(4096);
  psx[0] = 3;
  await page.getByLabel("选择游戏文件").setInputFiles([
    { name: "测试.nds", mimeType: "application/octet-stream", buffer: nds },
    { name: "测试.bin", mimeType: "application/octet-stream", buffer: md },
    { name: "测试.z64", mimeType: "application/octet-stream", buffer: n64 },
    { name: "测试.gbc", mimeType: "application/octet-stream", buffer: gbc },
    { name: "测试.chd", mimeType: "application/octet-stream", buffer: psx },
  ]);
  await expect(page.locator(".upload-results .success")).toHaveCount(5);
  await page.getByRole("button", { name: "去游戏库看看" }).click();
  await page.getByRole("link", { name: "外设设置", exact: true }).click();
  await page
    .getByRole("group", { name: "选择平台", exact: true })
    .getByRole("button", { name: "N64", exact: true })
    .click();
  await expect(page.locator(".binding-grid")).toContainText("摇杆 ↑");
  await expect(page.locator(".binding-grid")).toContainText("C ↑");
  await page.screenshot({ path: `${shots}/n64-controls.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${shots}/controls-mobile.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("新增内核资源可加载，Thwaite 游戏正常运行", async ({
  page,
  request,
}) => {
  for (const core of [
    "genesis_plus_gx",
    "pcsx_rearmed",
    "desmume",
    "mupen64plus_next",
    "gambatte",
    "fbneo",
    "mednafen_wswan",
    "ppsspp",
  ]) {
    const report = await request.get(`http://127.0.0.1:4174/lib/emulatorjs/4.2.3/data/cores/reports/${core}.json`);
    expect(report.ok()).toBe(true);
    expect((await report.json()).core).toBe(core);
    const binary = await request.get(
      `http://127.0.0.1:4174/lib/emulatorjs/4.2.3/data/cores/${core}${core === "ppsspp" ? "-thread" : ""}-wasm.data`,
    );
    expect(binary.ok()).toBe(true);
    expect(binary.headers()["content-type"]).not.toContain("text/html");
    expect((await binary.body()).length).toBeGreaterThan(10000);
  }
  await page.goto("/");
  await showLibrary(page);
  await page
    .getByRole("button", { name: "开始 Thwaite 测试副本", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled({
    timeout: 45000,
  });
  await page.getByRole("button", { name: "保存进度", exact: true }).click();
  await expect(
    page.getByText("进度已保存", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${shots}/thwaite-copy-platform-regression.png`,
    fullPage: true,
  });
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  expect(
    await frame.evaluate(() =>
      (window as any).EJS_emulator.gameManager.getSaveFilePath(),
    ),
  ).toContain("/data/saves/thwaite-copy/");
});
