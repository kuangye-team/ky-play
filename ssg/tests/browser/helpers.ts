import { expect, type Frame, type Page } from "@playwright/test";
export async function showLibrary(page: Page) {
  if ((page.viewportSize()?.width || 1440) <= 900) {
    const toggle = page.getByRole("button", { name: "展开导航", exact: true });
    if (await toggle.isVisible()) await toggle.click();
  }
  await page
    .locator(".sidebar")
    .getByRole("link", { name: /游戏库/ })
    .click();
  await expect(page.getByRole("heading", { name: /游戏库/ })).toBeVisible();
}

export async function waitForPicture(frame: Frame, minimumColors = 2) {
  // Thwaite's legal notice uses three colors; blank boot frames use only one.
  await expect
    .poll(
      () =>
        frame.evaluate(async () => {
          const bytes = await (
            window as any
          ).EJS_emulator.gameManager.screenshot();
          const picture = await createImageBitmap(
            new Blob([bytes], { type: "image/png" }),
          );
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 64;
          const context = canvas.getContext("2d")!;
          context.imageSmoothingEnabled = false;
          context.drawImage(picture, 0, 0, 64, 64);
          picture.close();
          return new Set(
            new Uint32Array(context.getImageData(0, 0, 64, 64).data.buffer),
          ).size;
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(minimumColors);
}

