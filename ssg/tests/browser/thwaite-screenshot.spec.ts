import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { importTestGames } from "./library-fixture";
import { waitForPicture } from "./helpers";
import { resolve } from "node:path";

test("Thwaite：运行和暂停时的截图、下载、封面与存档画面保留颜色", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await importTestGames(page);
  await page.reload();
  await page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true }).click();
  const capture = page.getByRole("button", { name: "截图", exact: true });
  await expect(capture).toBeEnabled({ timeout: 45_000 });
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  await waitForPicture(frame);
  // Skip the legal notice, wait for the title's colored cursor, then start play.
  await page.keyboard.press("Enter", { delay: 100 });
  await waitForPicture(frame, 3);
  await page.keyboard.press("Enter", { delay: 100 });
  await expect
    .poll(
      () =>
        frame.evaluate(
          () =>
            new Promise<number>((resolve) => {
              requestAnimationFrame(() => {
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = 64;
                const ctx = canvas.getContext("2d")!;
                ctx.drawImage(
                  (window as any).EJS_emulator.canvas,
                  0,
                  0,
                  64,
                  64,
                );
                const pixels = ctx.getImageData(0, 0, 64, 64).data;
                let colored = 0;
                for (let i = 0; i < pixels.length; i += 4)
                  if (
                    Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
                      Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
                    15
                  )
                    colored++;
                resolve(colored / 4096);
              });
            }),
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0.05);

  const colorRatio = (src: string) =>
    page.evaluate(async (src) => {
      const bitmap = await createImageBitmap(await (await fetch(src)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0, 64, 64);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, 64, 64).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
            Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
          15
        )
          colored++;
      return colored / 4096;
    }, src);
  let cover = "";
  for (const paused of [false, true]) {
    if (paused)
      await page.getByRole("button", { name: "暂停", exact: true }).click();
    await capture.click();
    const dialog = page.getByRole("dialog", { name: "游戏截图", exact: true });
    const picture = dialog.getByRole("img", { name: "小镇反弹道导弹 截图", exact: true });
    await expect(picture).toBeVisible();
    cover = (await picture.getAttribute("src"))!;
    expect(await colorRatio(cover)).toBeGreaterThan(0.05);
    await page.screenshot({
      path: resolve(
        import.meta.dirname,
        `../../../temp/screenshot/thwaite-screenshot-${paused ? "paused" : "playing"}.png`,
      ),
    });
    const downloading = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "下载图片", exact: true }).click();
    const download = await downloading;
    const bytes = await readFile((await download.path())!);
    expect(bytes.equals(Buffer.from(cover.split(",")[1], "base64"))).toBe(true);
    if (paused) {
      await download.saveAs(
        resolve(import.meta.dirname, "../../../temp/screenshot/thwaite-color-capture.png"),
      );
      await dialog
        .getByRole("button", { name: "设为封面", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: "已设为封面", exact: true }),
      ).toBeDisabled();
    }
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect
      .poll(() => frame.evaluate(() => (window as any).EJS_emulator.paused))
      .toBe(paused);
  }
  await page.getByRole("button", { name: "保存进度", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("进度已保存");
  const thumbnail = await page.evaluate(async () => {
    const { database } = await import("/src/lib/storage.ts");
    return (await (await database).getAll("saves"))[0].screenshot!;
  });
  expect(await colorRatio(thumbnail)).toBeGreaterThan(0.05);
  await page.getByRole("button", { name: "返回游戏库", exact: true }).click();
  await expect(page).toHaveURL("/library");
  await page.reload();
  await expect(
    page.getByRole("img", { name: "小镇反弹道导弹 游戏封面", exact: true }),
  ).toHaveAttribute("src", cover);
});
