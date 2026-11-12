import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.doUnmock("../runtime");
  vi.resetModules();
});
it.each([
  [false, 1024 ** 3 + 1, "1 GB"],
  [false, 1024 ** 3, "header reached"],
  [true, 1024 ** 3 + 1, "header reached"],
])(
  "desktop=%s applies the correct game size limit for %s bytes",
  async (desktop, size, error) => {
    vi.doMock("../runtime", () => ({ isDesktop: desktop }));
    vi.resetModules();
    const { importGame } = await import("../storage");
    const file = new File(["fake"], "large.iso");
    Object.defineProperty(file, "size", { value: size });
    vi.spyOn(file, "slice").mockImplementation(() => {
      throw new Error("header reached");
    });
    await expect(importGame(file)).rejects.toThrow(error);
  },
);
