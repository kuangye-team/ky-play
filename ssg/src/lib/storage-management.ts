import { isDesktop } from "./runtime";
import { translate } from "./i18n";
import {
  readNativeSaves,
  removeNativeSaves,
  removeDesktopNativeSaves,
} from "./native-saves";
import { database } from "./storage";
import type { Game, Save } from "./types";
import { localizeGame } from "./bundled-game";

export type BiosFile = { name: string; data: Blob };
export type StorageItem = {
  id: string;
  kind: "game" | "save";
  name: string;
  game?: Game;
  save?: Save;
  size: number;
  coverSize: number;
  nativePath?: string;
};
export type StorageSnapshot = {
  items: StorageItem[];
  gameBytes: number;
  saveBytes: number;
  otherBytes: number;
  totalBytes: number;
  bios?: BiosFile;
};
export const textBytes = (text?: string) => (text ? new Blob([text]).size : 0);
export const saveBytes = (save: Save) =>
  save.data.size + textBytes(save.screenshot);
export async function getBios(): Promise<BiosFile | undefined> {
  return (await (await database).get("settings", "psx-bios")) as
    BiosFile | undefined;
}
export async function putBios(file: File) {
  if (!/\.bin$/i.test(file.name) || file.size !== 512 * 1024)
    throw new Error(translate("请选择 512 KB 的 PSX 启动文件（.bin）。"));
  await (
    await database
  ).put("settings", { name: file.name, data: file }, "psx-bios");
}
export async function readStorage(): Promise<StorageSnapshot> {
  const db = await database;
  const { games, bios, items } = await db.transaction(
    ["games", "roms", "saves", "settings"],
    "readonly",
    async (tx) => {
      const storedGames = await tx.getAll("games");
      const games = storedGames.map(localizeGame);
      const saves = await tx.getAll("saves");
      const bios = (await tx.get("settings", "psx-bios")) as
        BiosFile | undefined;
      const items: StorageItem[] = [];
      for (const stored of storedGames) {
        const game = localizeGame(stored);
        const size = await tx.romSize(game.id);
        items.push({
          id: game.id,
          kind: "game",
          name: game.name,
          game,
          size,
          coverSize: stored.cover?.startsWith("data:")
            ? textBytes(stored.cover)
            : 0,
        });
      }
      for (const save of saves)
        items.push({
          id: save.id,
          kind: "save",
          name: save.name,
          save,
          game: games.find((game) => game.id === save.gameId),
          size: saveBytes(save),
          coverSize: 0,
        });
      return { games, saves, bios, items };
    },
  );
  for (const file of await readNativeSaves()) {
    const game = games.find((game) => game.id === file.gameId);
    items.push({
      id: `native:${file.path}`,
      kind: "save",
      name: translate("{{value0}} · 游戏内进度", {
        value0: game?.name || file.path.split("/").pop(),
      }),
      game,
      save: {
        id: `native:${file.path}`,
        gameId: file.gameId,
        name: translate("游戏内进度"),
        created: file.created,
        data: file.data,
      },
      size: file.data.size,
      coverSize: 0,
      nativePath: file.path,
    });
  }
  const gameBytes = items
    .filter((item) => item.kind === "game")
    .reduce((sum, item) => sum + item.size, 0);
  const saveSize = items
    .filter((item) => item.kind === "save")
    .reduce((sum, item) => sum + item.size, 0);
  const otherBytes =
    (bios?.data.size || 0) +
    items.reduce((sum, item) => sum + item.coverSize, 0);
  return {
    items,
    gameBytes,
    saveBytes: saveSize,
    otherBytes,
    totalBytes: gameBytes + saveSize + otherBytes,
    bios,
  };
}
export type Cleanup = {
  gameIds?: string[];
  saveIds?: string[];
  bios?: boolean;
};
export function cleanupItems(snapshot: StorageSnapshot, cleanup: Cleanup) {
  return snapshot.items.filter((item) =>
    item.kind === "game"
      ? cleanup.gameIds?.includes(item.id)
      : cleanup.saveIds?.includes(item.id) ||
        cleanup.gameIds?.includes(item.save!.gameId),
  );
}
export function cleanupBytes(snapshot: StorageSnapshot, cleanup: Cleanup) {
  return (
    cleanupItems(snapshot, cleanup).reduce(
      (sum, item) => sum + item.size + item.coverSize,
      0,
    ) + (cleanup.bios ? snapshot.bios?.data.size || 0 : 0)
  );
}
export async function cleanStorage(cleanup: Cleanup) {
  if (!isDesktop)
    await removeNativeSaves(
      (cleanup.saveIds || [])
        .filter((id) => id.startsWith("native:"))
        .map((id) => id.slice(7)),
      cleanup.gameIds,
    );
  const db = await database;
  await db.transaction(
    ["games", "roms", "saves", "settings", "nativeSaves"],
    "readwrite",
    async (tx) => {
      if (isDesktop)
        await removeDesktopNativeSaves(
          tx,
          (cleanup.saveIds || [])
            .filter((id) => id.startsWith("native:"))
            .map((id) => id.slice(7)),
          cleanup.gameIds || [],
        );
      const slots = (await tx.get("settings", "quick-slots")) as
        (string | null)[] | undefined;
      if (slots)
        await tx.put(
          "settings",
          slots.map((id) => (id && cleanup.gameIds?.includes(id) ? null : id)),
          "quick-slots",
        );
      for (const id of new Set(cleanup.gameIds)) {
        await tx.delete("games", id);
        await tx.delete("roms", id);
        for (const saveId of await tx
          .getAll("saves")
          .then((saves) =>
            saves.filter((save) => save.gameId === id).map((save) => save.id),
          ))
          await tx.delete("saves", saveId);
      }
      for (const id of new Set(cleanup.saveIds)) await tx.delete("saves", id);
      if (cleanup.bios) await tx.delete("settings", "psx-bios");
    },
  );
}
