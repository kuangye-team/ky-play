import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { BrowserStorage } from "./browser";
import { DesktopStorage } from "./desktop";
import type { Store } from "./adapter";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const stores: Store[] = [
  "games",
  "roms",
  "saves",
  "settings",
  "tags",
  "nativeSaves",
];
const records = new Map<string, any>();
const files = new Map<string, Uint8Array>();
let failCommit = false;
let failWrite = false;
let loseReply = false;
const referenced = () =>
  new Set<string>([...records.values()].flatMap((row) => row.files));
beforeEach(() => {
  records.clear();
  files.clear();
  failCommit = failWrite = loseReply = false;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, raw, options) => {
      const args = raw as any;
      if (command === "storage_read")
        return [...records.values()].filter(
          (row) =>
            row.store === args.store &&
            (args.key === undefined || row.key === args.key),
        );
      if (command === "storage_create_file") {
        const id = crypto.randomUUID();
        files.set(id, new Uint8Array());
        return id;
      }
      if (command === "storage_write_file") {
        if (failWrite) throw "Disk full";
        const id = (options!.headers as Record<string, string>)["x-file-id"];
        const bytes = new Uint8Array(args);
        const old = files.get(id)!;
        expect(
          Number((options!.headers as Record<string, string>)["x-file-offset"]),
        ).toBe(old.length);
        const next = new Uint8Array(old.length + bytes.length);
        next.set(old);
        next.set(bytes, old.length);
        files.set(id, next);
        return;
      }
      if (command === "storage_read_file")
        return files.get(args.id)!.slice(args.offset, args.offset + args.length)
          .buffer;
      if (command === "storage_commit") {
        if (failCommit) throw "Commit failed";
        for (const change of args.changes) {
          if (change.kind === "clear")
            for (const [id, row] of records) {
              if (row.store === change.store) records.delete(id);
            }
          else if (change.kind === "delete")
            records.delete(JSON.stringify([change.store, change.key]));
          else records.set(JSON.stringify([change.store, change.key]), change);
        }
        if (loseReply) throw "Lost reply";
        return;
      }
      if (command === "storage_discard_files") {
        const used = referenced();
        for (const id of args.ids) if (!used.has(id)) files.delete(id);
        return;
      }
      throw new Error(`Unexpected command ${command}`);
    });
});
for (const [name, create] of [
  ["browser", () => new BrowserStorage()],
  ["desktop", () => new DesktopStorage()],
] as const) {
  describe(name, () => {
    it("commits related records, exposes writes inside the transaction and restores binary data", async () => {
      const db = create();
      await db.transaction(stores, "readwrite", async (tx) => {
        for (const store of stores) await tx.clear(store);
      });
      const bytes = new Uint8Array(4 * 1024 ** 2 + 10);
      bytes[bytes.length - 1] = 42;
      await db.transaction(["roms", "settings"], "readwrite", async (tx) => {
        await tx.put("roms", new Blob([bytes]), "game");
        await tx.put(
          "settings",
          { data: new Blob(["bios"]), image: "data:image/png;base64,AAAA" },
          "nested",
        );
        expect(await tx.romSize("game")).toBe(bytes.length);
        expect(await tx.count("roms")).toBe(1);
      });
      expect(
        Buffer.from(await (await db.get("roms", "game"))!.arrayBuffer()).equals(
          Buffer.from(bytes),
        ),
      ).toBe(true);
      const nested = (await db.get("settings", "nested")) as {
        data: Blob;
        image: string;
      };
      expect(await nested.data.text()).toBe("bios");
      expect(nested.image).toBe("data:image/png;base64,AAAA");
    });
    it("rolls back a thrown callback and serializes concurrent read-modify-write operations", async () => {
      const db = create();
      await db.put("settings", 0, "counter");
      await expect(
        db.transaction(["settings"], "readwrite", async (tx) => {
          await tx.put("settings", 99, "counter");
          throw new Error("stop");
        }),
      ).rejects.toThrow("stop");
      expect(await db.get("settings", "counter")).toBe(0);
      await Promise.all(
        Array.from({ length: 10 }, () =>
          db.transaction(["settings"], "readwrite", async (tx) => {
            const value = (await tx.get("settings", "counter")) as number;
            await tx.put("settings", value + 1, "counter");
          }),
        ),
      );
      expect(await db.get("settings", "counter")).toBe(10);
    });
  });
}
it("desktop capacity checks never fetch ROM contents", async () => {
  const db = new DesktopStorage();
  await db.put("roms", new Blob(["hello"]), "game");
  vi.mocked(invoke).mockClear();
  expect(await db.romSize("game")).toBe(5);
  expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).toEqual([
    "storage_read",
  ]);
});
it.each(["write", "commit"])(
  "desktop %s failure cleans staged files and leaves the queue usable",
  async (failure) => {
    const db = new DesktopStorage();
    if (failure === "write") failWrite = true;
    else failCommit = true;
    await expect(
      db.put("roms", new Blob(["file"]), "game"),
    ).rejects.toBeInstanceOf(Error);
    expect(files.size).toBe(0);
    expect(records.size).toBe(0);
    failWrite = failCommit = false;
    await db.put("roms", new Blob(["retry"]), "game");
    expect(await (await db.get("roms", "game"))!.text()).toBe("retry");
  },
);
it("a lost commit reply cannot remove a committed file", async () => {
  const db = new DesktopStorage();
  loseReply = true;
  await expect(db.put("roms", new Blob(["keep"]), "game")).rejects.toThrow(
    "暂时无法访问本机文件",
  );
  expect(await (await db.get("roms", "game"))!.text()).toBe("keep");
});
it("migration waits for pending writes and later transactions wait for migration", async () => {
  const db = new DesktopStorage();
  let releaseWrite!: () => void;
  let releaseMove!: () => void;
  const writing = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const moving = new Promise<void>((resolve) => { releaseMove = resolve; });
  const native = vi.mocked(invoke).getMockImplementation()!;
  const order: string[] = [];
  vi.mocked(invoke).mockImplementation(async (...args) => {
    if (args[0] === "storage_move") {
      order.push("move");
      await moving;
      return { directory: "/new-folder" };
    }
    return native(...args);
  });
  const first = db.transaction(["settings"], "readwrite", async (tx) => {
    order.push("write");
    await writing;
    await tx.put("settings", 42, "before");
  });
  const migration = db.moveStorage("/new-folder");
  const last = db.transaction(["settings"], "readonly", async (tx) => {
    order.push("read");
    return tx.get("settings", "before");
  });
  await vi.waitFor(() => expect(order).toEqual(["write"]));
  releaseWrite();
  await first;
  await vi.waitFor(() => expect(order).toEqual(["write", "move"]));
  releaseMove();
  await expect(migration).resolves.toEqual({ directory: "/new-folder" });
  await expect(last).resolves.toBe(42);
  expect(order).toEqual(["write", "move", "read"]);
});
it("a failed migration reports a useful error and leaves the storage queue usable", async () => {
  const db = new DesktopStorage();
  vi.mocked(invoke).mockRejectedValueOnce("storage_directory_not_empty");
  await expect(db.moveStorage("/occupied")).rejects.toThrow("请选择空文件夹");
  await db.put("settings", "still usable", "after");
  await expect(db.get("settings", "after")).resolves.toBe("still usable");
});
