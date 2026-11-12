import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isDesktop: true,
  setTheme: vi.fn(),
  setBackgroundColor: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("./runtime", () => ({ get isDesktop() { return native.isDesktop; } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

const light = { scheme: "light", color: "#f0f4ec", textColor: "#34452e" } as const;
const dark = { scheme: "dark", color: "#141622", textColor: "#eceaf6" } as const;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  native.isDesktop = true;
});
afterEach(() => vi.restoreAllMocks());

it("keeps the last rapidly selected theme after a slower native update", async () => {
  const { syncDesktopTheme } = await import("./desktop-window");
  let release!: () => void;
  native.setTheme.mockImplementationOnce(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  const first = syncDesktopTheme(light);
  const last = syncDesktopTheme(dark);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(native.setTheme).toHaveBeenCalledTimes(1);
  expect(native.invoke).not.toHaveBeenCalled();
  release();
  await Promise.all([first, last]);
  expect(native.setTheme.mock.calls).toEqual([["light"], ["dark"]]);
  expect(native.setBackgroundColor.mock.calls).toEqual([[light.color], [dark.color]]);
  expect(native.invoke.mock.calls).toEqual([
    ["set_title_bar_color", { color: light.color, textColor: light.textColor }],
    ["set_title_bar_color", { color: dark.color, textColor: dark.textColor }],
  ]);
});

it("continues syncing when native caption colors are unavailable", async () => {
  const { syncDesktopTheme } = await import("./desktop-window");
  const error = new Error("Caption colors unavailable");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  native.invoke.mockRejectedValueOnce(error);
  await syncDesktopTheme(light);
  await syncDesktopTheme(dark);
  expect(log).toHaveBeenCalledWith("Could not update the window theme", error);
  expect(native.setBackgroundColor).toHaveBeenLastCalledWith(dark.color);
  expect(native.invoke).toHaveBeenLastCalledWith("set_title_bar_color", {
    color: dark.color, textColor: dark.textColor,
  });
});

it("does not call native window APIs in the browser", async () => {
  native.isDesktop = false;
  const { syncDesktopTheme } = await import("./desktop-window");
  await syncDesktopTheme(light);
  expect(native.setTheme).not.toHaveBeenCalled();
  expect(native.setBackgroundColor).not.toHaveBeenCalled();
  expect(native.invoke).not.toHaveBeenCalled();
});
