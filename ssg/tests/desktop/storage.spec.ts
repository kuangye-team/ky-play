import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { mockDesktopStorage } from "./storage-fixture";

test.beforeEach(async ({ page }) => {
  await mockDesktopStorage(page);
});

test("desktop imports, restores and cleans files without IndexedDB", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "从设备添加游戏", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("文件保存在这台设备");
  await expect(page.getByRole("dialog")).not.toContainText("1 GB");
  await page.evaluate(async () => {
    const { deleteGame } = await import("/src/lib/storage.ts");
    await deleteGame("thwaite-nes");
  });
  await page
    .getByLabel("选择游戏文件")
    .setInputFiles(resolve("public/game/thwaite.nes"));
  await expect(page.locator(".upload-results .success")).toHaveCount(1);
  await page.getByRole("button", { name: "去游戏库看看" }).click();
  await page.evaluate(async () => {
    const { database, putSave, setQuickSlot } =
      await import("/src/lib/storage.ts");
    const db = await database;
    const game = (await db.getAll("games")).find(
      (game) => game.id !== "nes-runner",
    )!;
    await setQuickSlot(1, game.id);
    await putSave(
      {
        id: "native-test",
        gameId: game.id,
        name: "客户端存档",
        created: 1,
        data: new Blob(["state"]),
        screenshot: "data:image/png;base64,AAAA",
      },
      [
        {
          path: `/data/saves/${game.id}/progress.srm`,
          created: 1,
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    );
    const { setPreferences } = await import("/src/lib/preferences.ts");
    setPreferences({ theme: "ocean" });
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await page.getByRole("link", { name: "存储管理", exact: true }).click();
  await expect(page.getByText("客户端存档", { exact: true })).toBeVisible();
  await expect(page.getByText(/thwaite · 游戏内进度/)).toBeVisible();
  await expect(page.getByText("设备可用空间约 75.00 GB")).toBeVisible();
  await page.screenshot({
    path: resolve("../temp/screenshot/desktop-storage-adapter.png"),
    fullPage: true,
  });
  await page.evaluate(async () => {
    const { readStorage, cleanStorage } =
      await import("/src/lib/storage-management.ts");
    const snapshot = await readStorage();
    const game = snapshot.items.find(
      (item) => item.kind === "game" && item.id !== "nes-runner",
    )!;
    await cleanStorage({ gameIds: [game.id] });
    const { database } = await import("/src/lib/storage.ts");
    const db = await database;
    if (
      (await db.getAll("nativeSaves")).length ||
      (await db.getAll("saves")).length
    )
      throw new Error("Orphan saves");
    if (
      ((await db.get("settings", "quick-slots")) as string[]).includes(game.id)
    )
      throw new Error("Orphan shortcut");
  });
  await page.reload();
  await expect(page.locator(".storage-total")).toHaveText("0 B");
  expect(errors).toEqual([]);
});

test("desktop reports write failures and a retry can import the game", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "从设备添加游戏", exact: true })
    .first()
    .click();
  await page.evaluate(async () => {
    const { deleteGame } = await import("/src/lib/storage.ts");
    await deleteGame("thwaite-nes");
    (window as any).failStorageCommit = true;
  });
  await page
    .getByLabel("选择游戏文件")
    .setInputFiles(resolve("public/game/thwaite.nes"));
  await expect(page.locator(".upload-results .error")).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).failStorageCommit = false;
  });
  await page
    .getByLabel("选择游戏文件")
    .setInputFiles(resolve("public/game/thwaite.nes"));
  await expect(page.locator(".upload-results .success")).toHaveCount(1);
});

test("desktop emulator restores in-game files through the adapter", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "保存进度", exact: true }),
  ).toBeEnabled({ timeout: 90_000 });
  let frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  await frame.evaluate(() => {
    const fs = (window as any).EJS_emulator.gameManager.FS;
    fs.writeFile(
      "/data/saves/thwaite-nes/adapter-test.srm",
      new Uint8Array([11, 22, 33]),
    );
  });
  await page.getByRole("button", { name: "返回游戏库", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /游玩窗口/ })).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "保存进度", exact: true }),
  ).toBeEnabled({ timeout: 90_000 });
  frame = page.frames().find((frame) => frame.url().endsWith("/player.html"))!;
  expect(
    await frame.evaluate(() =>
      Array.from(
        (window as any).EJS_emulator.gameManager.FS.readFile(
          "/data/saves/thwaite-nes/adapter-test.srm",
        ),
      ),
    ),
  ).toEqual([11, 22, 33]);
  await page.screenshot({
    path: resolve("../temp/screenshot/desktop-storage-game-restore.png"),
    fullPage: true,
  });
});
