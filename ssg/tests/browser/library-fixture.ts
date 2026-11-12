import { expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

// Import only the bundled, unmodified Thwaite ROM. Additional library entries are
// metadata copies for filtering and multi-item tests, not additional games.
export async function importTestGames(page: Page) {
  await page.goto("/");
  await expect(page.locator(".banner-cta")).toBeEnabled();
  await page.evaluate(async () => {
    const { deleteGame } = await import("/src/lib/storage.ts");
    await deleteGame("thwaite-nes");
    await deleteGame("nes-runner");
  });
  await page
    .getByRole("button", { name: "从设备添加游戏", exact: true })
    .first()
    .click();
  await page
    .getByLabel("选择游戏文件")
    .setInputFiles(
      resolve(import.meta.dirname, "../../public/game/thwaite.nes"),
    );
  await expect(page.locator(".upload-results .success")).toHaveCount(1);
  await page.getByRole("button", { name: "去游戏库看看" }).click();
  await page.evaluate(async () => {
    const { database } = await import("/src/lib/storage.ts");
    const db = await database;
    await db.transaction(["games", "roms"], "readwrite", async (tx) => {
      const game = (await tx.getAll("games"))[0];
      const rom = (await tx.get("roms", game.id))!;
      await tx.delete("games", game.id);
      await tx.delete("roms", game.id);
      for (const [id, name, tags] of [
        ["thwaite-test", "小镇反弹道导弹", ["classic", "challenge"]],
        ["thwaite-copy", "Thwaite 测试副本", ["classic", "relax"]],
      ] as const) {
        await tx.put("games", { ...game, id, name, tags: [...tags] });
        await tx.put("roms", rom, id);
      }
    });
  });
}
