import type { Game, Save, Tag } from "../types";

export type NativeSave = {
  path: string;
  gameId: string;
  created: number;
  data: Blob;
};
export type Records = {
  games: Game;
  roms: Blob;
  tags: Tag;
  saves: Save;
  settings: unknown;
  nativeSaves: NativeSave;
};
export type Store = keyof Records;
export type StorageInfo = { directory: string; cleanupWarning?: boolean };
export type Session = {
  get<S extends Store>(store: S, key: string): Promise<Records[S] | undefined>;
  getAll<S extends Store>(store: S): Promise<Records[S][]>;
  put<S extends Store>(
    store: S,
    value: Records[S],
    key?: string,
  ): Promise<void>;
  delete(store: Store, key: string): Promise<void>;
  clear(store: Store): Promise<void>;
  count(store: Store): Promise<number>;
  /** Inspect a ROM without loading its bytes into the WebView. */
  romSize(key: string): Promise<number>;
};
export abstract class StorageAdapter implements Session {
  getStorageInfo?(): Promise<StorageInfo>;
  moveStorage?(directory: string): Promise<StorageInfo>;
  abstract transaction<T>(
    stores: Store[],
    mode: "readonly" | "readwrite",
    run: (tx: Session) => Promise<T>,
  ): Promise<T>;
  abstract estimate(): Promise<StorageEstimate | undefined>;
  get<S extends Store>(store: S, key: string) {
    return this.transaction([store], "readonly", (tx) => tx.get(store, key));
  }
  getAll<S extends Store>(store: S) {
    return this.transaction([store], "readonly", (tx) => tx.getAll(store));
  }
  put<S extends Store>(store: S, value: Records[S], key?: string) {
    return this.transaction([store], "readwrite", (tx) =>
      tx.put(store, value, key),
    );
  }
  delete(store: Store, key: string) {
    return this.transaction([store], "readwrite", (tx) =>
      tx.delete(store, key),
    );
  }
  clear(store: Store) {
    return this.transaction([store], "readwrite", (tx) => tx.clear(store));
  }
  count(store: Store) {
    return this.transaction([store], "readonly", (tx) => tx.count(store));
  }
  romSize(key: string) {
    return this.transaction(["roms"], "readonly", (tx) => tx.romSize(key));
  }
}
export function recordKey(store: Store, value: unknown, key?: string): string {
  const result =
    key ??
    (store === "nativeSaves"
      ? (value as NativeSave).path
      : (value as { id?: string })?.id);
  if (typeof result !== "string" || !result)
    throw new Error("Missing storage key");
  return result;
}
