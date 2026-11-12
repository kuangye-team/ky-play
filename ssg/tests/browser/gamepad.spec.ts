import { importTestGames } from "./library-fixture";
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { showLibrary } from "./helpers";

test.beforeEach(async ({ page }) => {
  await importTestGames(page);
});

const shots = resolve(import.meta.dirname, "../../../temp/screenshot");
async function mockGamepad(
  page: Page,
  mapping = "standard",
  initial?: { id: string; buttonCount: number; axes: number[] },
) {
  await page.addInitScript(
    ({ mapping, initial }) => {
      if (window === window.top)
        (window as any).testPad = {
          id: initial?.id ?? "Test Gamepad",
          index: 2,
          connected: true,
          mapping,
          buttons: Array.from({ length: initial?.buttonCount ?? 17 }, () => ({
            pressed: false,
            value: 0,
          })),
          axes: initial?.axes ?? [0, 0, 0, 0],
        };
      Object.defineProperty(navigator, "getGamepads", {
        value: () => [null, null, (window.top as any).testPad],
      });
    },
    { mapping, initial },
  );
}
async function press(page: Page, buttons: number[] = [], axes = [0, 0, 0, 0]) {
  await page.evaluate(
    ({ buttons, axes }) => {
      const pad = (window as any).testPad;
      pad.buttons = pad.buttons.map((_: unknown, index: number) => ({
        pressed: buttons.includes(index),
        value: buttons.includes(index) ? 1 : 0,
      }));
      pad.axes = axes;
    },
    { buttons, axes },
  );
  await expect(
    page.locator(".gamepad-buttons .is-pressed").first(),
  ).toHaveCount(buttons.length ? 1 : 0);
}

test("标准手柄驱动真实 NES，实时显示按钮，暂停和断连释放输入", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockGamepad(page);
  await page.goto("/");
  await showLibrary(page);
  await page
    .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled({
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "手柄设置", exact: true }).click();
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  await frame.evaluate(() => {
    const manager = (window as any).EJS_emulator.gameManager;
    const input = manager.simulateInput.bind(manager);
    (window as any).inputLog = [];
    manager.simulateInput = (...args: unknown[]) => {
      (window as any).inputLog.push(args);
      return input(...args);
    };
  });
  const log = () =>
    frame.evaluate(() => (window as any).inputLog as number[][]);
  await press(page, [7]);
  await expect(page.locator('[data-button="7"]')).toHaveClass(/is-pressed/);
  expect(await log()).toEqual([]);
  for (const [button, index, id] of [
    [0, 8, "a"],
    [1, 0, "b"],
    [8, 2, "select"],
    [9, 3, "start"],
    [12, 4, "up"],
    [13, 5, "down"],
    [14, 6, "left"],
    [15, 7, "right"],
  ] as const) {
    await press(page, [button]);
    await expect(page.locator(`.play-sidebar .pad-${id}`)).toHaveClass(
      /pressed/,
    );
    await expect.poll(log).toContainEqual([0, index, 1]);
    await press(page);
    await expect(page.locator(`.play-sidebar .pad-${id}`)).not.toHaveClass(
      /pressed/,
    );
    await expect.poll(log).toContainEqual([0, index, 0]);
  }
  expect(
    (await log()).filter((entry) => entry[1] === 3 && entry[2] === 1),
  ).toHaveLength(1);
  await press(page, [0], [0.8, -0.8, 0, 0]);
  await expect(page.locator(".play-sidebar .pad-up")).toHaveClass(/pressed/);
  await expect(page.locator(".play-sidebar .pad-right")).toHaveClass(/pressed/);
  await page.screenshot({
    animations: "disabled",
    path: `${shots}/gamepad-nes-live.png`,
  });
  await frame.locator("canvas").click();
  await expect(page.locator(".play-sidebar .pad-right")).toHaveClass(/pressed/);
  await page.keyboard.down("x");
  await press(page);
  await expect(page.locator(".play-sidebar .pad-a")).toHaveClass(/pressed/);
  await page.keyboard.up("x");
  await expect(page.locator(".play-sidebar .pad-a")).not.toHaveClass(/pressed/);
  await press(page, [1]);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.locator(".play-sidebar .pad-key.pressed")).toHaveCount(0);
  await press(page, [9]);
  await expect(page.locator(".play-sidebar .pad-start")).not.toHaveClass(
    /pressed/,
  );
  await press(page);
  await page.getByRole("button", { name: "继续游戏", exact: true }).click();
  await press(page, [0]);
  await expect(page.locator(".play-sidebar .pad-a")).toHaveClass(/pressed/);
  await page.evaluate(() => {
    (window as any).testPad.connected = false;
  });
  await expect(page.locator(".play-sidebar .pad-key.pressed")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "手柄实时状态" }),
  ).toContainText("等待连接");
  await page.evaluate(() => {
    (window as any).testPad.connected = true;
  });
  await expect(page.locator(".play-sidebar .pad-a")).toHaveClass(/pressed/);
  await press(page);
  await page.getByRole("button", { name: "自定义按键", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "设置手柄", exact: true }),
  ).toBeVisible();
  await press(page, [0, 15]);
  await page.screenshot({
    animations: "disabled",
    path: `${shots}/gamepad-settings-desktop.png`,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    animations: "disabled",
    path: `${shots}/gamepad-settings-mobile.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors.filter((error) => !error.includes("Wake Lock"))).toEqual([]);
});

test("未识别布局逐个设置，按设备保存且重新打开游戏生效", async ({ page }) => {
  await mockGamepad(page, "");
  await page.goto("/");
  await showLibrary(page);
  await page.getByRole("link", { name: "外设设置", exact: true }).click();
  await page.getByRole("button", { name: "手柄", exact: true }).click();
  await expect(page.locator(".gamepad-monitor")).toContainText(
    "需要先设置按键",
  );
  await page.getByRole("button", { name: "设置手柄", exact: true }).click();
  for (const [label, button] of [
    ["上", 12],
    ["下", 13],
    ["左", 14],
    ["右", 15],
    ["A", 0],
    ["B", 3],
    ["选择", 10],
    ["开始", 11],
  ] as const) {
    await expect(
      page.locator(".gamepad-settings .binding-status"),
    ).toContainText(`「${label}」`);
    await press(page, [button]);
    await press(page);
  }
  await expect(page.locator(".gamepad-settings")).toContainText(
    "手柄按键已保存",
  );
  await page.reload();
  await showLibrary(page);
  await page
    .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled({
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "手柄设置", exact: true }).click();
  await press(page, [9]);
  await expect(page.locator(".play-sidebar .pad-start")).not.toHaveClass(
    /pressed/,
  );
  await press(page, [11]);
  await expect(page.locator(".play-sidebar .pad-start")).toHaveClass(/pressed/);
  await press(page, [3]);
  await expect(page.locator(".play-sidebar .pad-b")).toHaveClass(/pressed/);
});

test("北通的方向键、右摇杆和扳机经设置后驱动真实 NES，松开即停止", async ({
  page,
}) => {
  const neutral = [
    0.00392, 0.00392, 0.0902, -1, -1, -0.02745, 0, 0, 0, 3.28571,
  ];
  await mockGamepad(page, "", {
    id: "BETOP 2585N2 BFM (Vendor: 20bc Product: 5500)",
    buttonCount: 15,
    axes: neutral,
  });
  await page.goto("/");
  await showLibrary(page);
  await page.getByRole("link", { name: "外设设置", exact: true }).click();
  await page.getByRole("button", { name: "手柄", exact: true }).click();
  await expect(page.locator(".gamepad-axis")).toHaveCount(10);
  await expect(page.locator(".gamepad-stick")).toHaveCount(0);
  await page.getByText("查看按键编号", { exact: true }).click();
  await expect(page.locator(".gamepad-details")).toContainText(
    "AXIS 9: 3.28571",
  );
  await expect(page.locator(".gamepad-details")).toContainText(
    "AXIS 5: -0.02745",
  );
  await page.getByText("查看按键编号", { exact: true }).click();

  const status = page.locator(".gamepad-settings .binding-status");
  const move = async (index: number, value: number) => {
    const axes = [...neutral];
    axes[index] = value;
    await press(page, [], axes);
    await expect(page.locator(`[data-axis="${index}"] output`)).toHaveText(
      value.toFixed(2),
    );
  };
  await page.getByRole("button", { name: "设置手柄", exact: true }).click();
  for (const [label, direction, nextLabel] of [
    ["上", 0, "下"],
    ["下", 4, "左"],
    ["左", 6, "右"],
    ["右", 2, "A"],
  ] as const) {
    await expect(status).toContainText(`「${label}」`);
    await move(9, direction / 3.5 - 1);
    await expect(status).toContainText(`「${nextLabel}」`);
    if (direction === 0) {
      // Crossing another direction while held is not a release.
      await move(9, 4 / 3.5 - 1);
      await move(9, 6 / 3.5 - 1);
      await expect(status).toContainText("「下」");
    }
    await move(9, neutral[9]);
  }
  await move(5, -1);
  await expect(status).toContainText("「B」");
  await move(5, -0.4);
  await move(5, -1);
  await expect(status).toContainText("「B」");
  await move(5, neutral[5]);
  await move(5, 1);
  await expect(status).toContainText("「选择」");
  await move(5, neutral[5]);
  // A trigger is first captured part-way through its travel.
  await move(3, -0.3);
  await expect(status).toContainText("「开始」");
  await move(3, -0.2);
  await move(3, 1);
  await expect(status).toContainText("「开始」");
  await expect(status).not.toContainText("手柄按键已保存");
  await move(3, -1);
  await press(page, [11], neutral);
  await expect(status).toContainText("手柄按键已保存");
  await press(page, [], neutral);
  await page
    .locator(".gamepad-monitor")
    .screenshot({ path: `${shots}/gamepad-betop-settings.png` });

  await page.reload();
  await showLibrary(page);
  await page
    .getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled({
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "手柄设置", exact: true }).click();
  const frame = page
    .frames()
    .find((frame) => frame.url().endsWith("/player.html"))!;
  await frame.evaluate(() => {
    const manager = (window as any).EJS_emulator.gameManager;
    const simulate = manager.simulateInput.bind(manager);
    (window as any).inputLog = [];
    manager.simulateInput = (...args: unknown[]) => {
      (window as any).inputLog.push(args);
      return simulate(...args);
    };
  });
  const log = () =>
    frame.evaluate(() => (window as any).inputLog as number[][]);
  for (const [axis, value, actions] of [
    [9, -1, [["up", 4]]],
    [9, 4 / 3.5 - 1, [["down", 5]]],
    [9, 6 / 3.5 - 1, [["left", 6]]],
    [9, 2 / 3.5 - 1, [["right", 7]]],
    [
      9,
      1 / 3.5 - 1,
      [
        ["up", 4],
        ["right", 7],
      ],
    ],
    [5, -1, [["a", 8]]],
    [5, 1, [["b", 0]]],
    [3, 1, [["select", 2]]],
  ] as const) {
    await frame.evaluate(() => {
      (window as any).inputLog = [];
    });
    await move(axis, value);
    for (const [id, index] of actions) {
      await expect(page.locator(`.play-sidebar .pad-${id}`)).toHaveClass(
        /pressed/,
      );
      await expect.poll(log).toContainEqual([0, index, 1]);
    }
    await move(axis, neutral[axis]);
    for (const [id, index] of actions) {
      await expect(page.locator(`.play-sidebar .pad-${id}`)).not.toHaveClass(
        /pressed/,
      );
      await expect.poll(log).toContainEqual([0, index, 0]);
    }
  }
  await move(9, 1 / 3.5 - 1);
  await page
    .locator(".gamepad-monitor")
    .screenshot({ path: `${shots}/gamepad-betop-live.png` });
  // Another controller can use a completely different physical button for A.
  // Its saved bindings must not overwrite or inherit the BETOP profile.
  await page.evaluate(() => {
    (window as any).testPad.id = "Another controller";
  });
  await expect(page.locator(".play-sidebar .pad-key.pressed")).toHaveCount(0);
  await page.getByRole("button", { name: "设置手柄", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await press(page, [], neutral);
  await dialog.getByRole("button", { name: "设置手柄 A", exact: true }).click();
  await press(page, [4], neutral);
  await expect(status).toContainText("手柄按键已保存");
  await expect(
    dialog.getByRole("button", { name: "设置手柄 A", exact: true }),
  ).toContainText("B4");
  // Saving one control does not incorrectly mark the whole controller ready.
  await expect(dialog.locator(".gamepad-hint").first()).toContainText(
    "需要先设置按键",
  );
  await press(page, [], neutral);
  await page.evaluate(() => {
    (window as any).testPad.id =
      "BETOP 2585N2 BFM (Vendor: 20bc Product: 5500)";
  });
  await expect(
    dialog.getByRole("button", { name: "设置手柄 A", exact: true }),
  ).toContainText("输入 6−");
  await expect(dialog.locator(".gamepad-hint").first()).not.toContainText(
    "需要先设置按键",
  );
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await move(5, -1);
  await expect(page.locator(".play-sidebar .pad-a")).toHaveClass(/pressed/);
  await move(5, neutral[5]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "自定义按键", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator(".gamepad-monitor")
    .screenshot({ path: `${shots}/gamepad-betop-mobile.png` });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
