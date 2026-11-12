import { isDesktop } from "../runtime";
import type { StorageAdapter } from "./adapter";

export const maxGameSize = isDesktop ? Infinity : 1024 ** 3;
export const database: Promise<StorageAdapter> = Promise.resolve().then(
  async () => {
    if (isDesktop) {
      const { DesktopStorage } = await import("./desktop");
      return new DesktopStorage();
    }
    const { BrowserStorage } = await import("./browser");
    return new BrowserStorage();
  },
);
void database.catch(() => {});
