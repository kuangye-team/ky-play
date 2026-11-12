import type { Page } from "@playwright/test";

/** IPC fixture only: Rust tests cover the actual SQLite/filesystem implementation. */
export async function mockDesktopStorage(page: Page) {
  await page.addInitScript(() => {
    const native = (window as any).__TAURI_INTERNALS__;
    const previous = native?.invoke;
    const state = JSON.parse(
      sessionStorage.getItem("native-storage-fixture") ||
        '{"records":{},"files":{}}',
    );
    const save = () =>
      sessionStorage.setItem("native-storage-fixture", JSON.stringify(state));
    const key = (store: string, id: string) => JSON.stringify([store, id]);
    const references = () =>
      new Set<string>(
        Object.values(state.records).flatMap((row: any) => row.files || []),
      );
    const collect = () => {
      const used = references();
      for (const id of Object.keys(state.files))
        if (!used.has(id)) delete state.files[id];
    };
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        ...native,
        invoke: async (command: string, args: any, options: any) => {
          if (command === "plugin:app|version") return "1.0.0";
          if (command === "plugin:dialog|open") {
            (window as any).lastDirectoryOptions = args.options;
            return (window as any).selectedStorageDirectory ?? null;
          }
          if (!command.startsWith("storage_"))
            return previous?.(command, args, options);
          if (command === "storage_read")
            return Object.values(state.records).filter(
              (row: any) =>
                row.store === args.store &&
                (args.key === undefined || row.key === args.key),
            );
          if (command === "storage_create_file") {
            const id = crypto.randomUUID();
            state.files[id] = [];
            return id;
          }
          if (command === "storage_write_file") {
            const id = options.headers["x-file-id"];
            if (
              state.files[id].length !==
              Number(options.headers["x-file-offset"])
            )
              throw new Error("Invalid offset");
            state.files[id] = state.files[id].concat(
              Array.from(new Uint8Array(args)),
            );
            return;
          }
          if (command === "storage_read_file")
            return new Uint8Array(
              state.files[args.id].slice(
                args.offset,
                args.offset + args.length,
              ),
            ).buffer;
          if (command === "storage_commit") {
            if ((window as any).failStorageCommit)
              throw new Error("Storage unavailable");
            for (const change of args.changes) {
              if (change.kind === "clear") {
                for (const [id, row] of Object.entries<any>(state.records))
                  if (row.store === change.store) delete state.records[id];
              } else if (change.kind === "delete")
                delete state.records[key(change.store, change.key)];
              else state.records[key(change.store, change.key)] = change;
            }
            collect();
            save();
            return;
          }
          if (command === "storage_discard_files") {
            collect();
            save();
            return;
          }
          if (command === "storage_estimate")
            return { quota: 100 * 1024 ** 3, usage: 25 * 1024 ** 3 };
          if (command === "storage_info") {
            if ((window as any).failStorageInfo) throw "unavailable";
            return { directory: state.directory || "/Users/player/Library/Application Support/com.kuangye.ky-play" };
          }
          if (command === "storage_move") {
            (window as any).storageMoveCalls = ((window as any).storageMoveCalls || 0) + 1;
            if ((window as any).storageMoveDelay)
              await new Promise((resolve) => setTimeout(resolve, (window as any).storageMoveDelay));
            if ((window as any).failStorageMove) throw (window as any).failStorageMove;
            state.directory = args.directory;
            save();
            return { directory: state.directory, cleanupWarning: !!(window as any).storageCleanupWarning };
          }
          throw new Error(`Unexpected command: ${command}`);
        },
      },
    });
    // Desktop code must not quietly continue using a browser database.
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("Desktop accessed IndexedDB");
      },
    });
  });
}
