import { openDB } from "idb";
import {
  StorageAdapter,
  recordKey,
  type Records,
  type Store,
  type Session,
} from "./adapter";

type LibraryDB = { [S in Store]: { key: string; value: Records[S] } };
export class BrowserStorage extends StorageAdapter {
  private db = openDB<LibraryDB>("shiguang-library", 2, {
    upgrade(db, version) {
      if (version < 1) {
        db.createObjectStore("games", { keyPath: "id" });
        db.createObjectStore("roms");
        db.createObjectStore("tags", { keyPath: "id" });
        db.createObjectStore("saves", { keyPath: "id" });
        db.createObjectStore("settings");
      }
      if (version < 2) db.createObjectStore("nativeSaves", { keyPath: "path" });
    },
  });
  constructor() {
    super();
    void this.db.catch(() => {});
  }
  async transaction<T>(
    stores: Store[],
    mode: "readonly" | "readwrite",
    run: (tx: Session) => Promise<T>,
  ): Promise<T> {
    const db = await this.db;
    const tx = db.transaction(stores, mode);
    // Observe rejection immediately, including when a request fails before run returns.
    void tx.done.catch(() => {});
    const session: Session = {
      get: (store, key) => tx.objectStore(store).get(key),
      getAll: <S extends Store>(store: S) =>
        tx.objectStore(store).getAll() as Promise<Records[S][]>,
      put: async (store, value, key) => {
        const id = recordKey(store, value, key);
        await tx.objectStore(store).put!(
          value,
          store === "roms" || store === "settings" ? id : undefined,
        );
      },
      delete: (store, key) => tx.objectStore(store).delete!(key),
      clear: (store) => tx.objectStore(store).clear!(),
      count: (store) => tx.objectStore(store).count(),
      romSize: async (key) =>
        (await tx.objectStore("roms").get(key))?.size ?? 0,
    };
    try {
      const result = await run(session);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already aborted */
      }
      await tx.done.catch(() => {});
      throw error;
    }
  }
  async estimate() {
    return navigator.storage?.estimate();
  }
}
