import { afterEach, expect, it } from "vitest";
import { deleteDB, openDB } from "idb";
import { database, deleteGame } from "./storage";
import { readStorage, cleanStorage, cleanupBytes } from "./storage-management";
import { readNativeSaves } from "./native-saves";

afterEach(async () => {
  await deleteDB("/data/saves");
  const db = await database;
  for (const name of ["games", "roms", "saves", "settings", "tags"] as const)
    await db.clear(name);
});
async function fixture() {
  const library = await database;
  for (const [id, system] of [["thwaite", "nes"], ["thwaite-copy", "nes"]] as const)
    await library.put("games", {
      id, name: id, system, filename: `${id}.${system}`, tags: [],
      favorite: false, added: 1, playSeconds: 0, hash: id, size: 0,
    });
  const db = await openDB("/data/saves", 21, {
    upgrade(db) {
      db.createObjectStore("FILE_DATA");
    },
  });
  await db.put(
    "FILE_DATA",
    { timestamp: new Date(), mode: 0x4000 },
    "/data/saves/thwaite",
  );
  await db.put(
    "FILE_DATA",
    { timestamp: new Date(), mode: 0x8000, contents: new Uint8Array(8192) },
    "/data/saves/thwaite/thwaite.srm",
  );
  await db.put(
    "FILE_DATA",
    { timestamp: new Date(), mode: 0x8000, contents: new Uint8Array(2048) },
    "/data/saves/thwaite-copy/thwaite-copy.srm",
  );
  db.close();
}
it("读取游戏内存档，不创建空数据库、不统计文件夹", async () => {
  expect(await readNativeSaves()).toEqual([]);
  expect(
    (await indexedDB.databases()).some((db) => db.name === "/data/saves"),
  ).toBe(false);
  await fixture();
  const stats = await readStorage();
  expect(stats.saveBytes).toBe(10240);
  expect(stats.items.filter((item) => item.nativePath)).toHaveLength(2);
  expect(cleanupBytes(stats, { gameIds: ["thwaite"] })).toBe(8192);
});
it("批量清理游戏会同步清理其游戏内存档，其他游戏不受影响", async () => {
  await fixture();
  await cleanStorage({ gameIds: ["thwaite"] });
  expect((await readNativeSaves()).map((file) => file.gameId)).toEqual([
    "thwaite-copy",
  ]);
  expect((await readStorage()).saveBytes).toBe(2048);
});
it("游戏库删除与单独清理游戏内存档均能释放对应空间", async () => {
  await fixture();
  await cleanStorage({ saveIds: ["native:/data/saves/thwaite/thwaite.srm"] });
  expect(await (await database).get("games", "thwaite")).toBeDefined();
  await deleteGame("thwaite-copy");
  expect(await readNativeSaves()).toEqual([]);
});
