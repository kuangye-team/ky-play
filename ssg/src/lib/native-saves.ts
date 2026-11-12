import { isDesktop } from "./runtime";
import { database } from "./storage/index";
import type { NativeSave, Session } from "./storage/adapter";
export type NativeSavePayload = {
  path: string;
  data: Uint8Array;
  created: number;
};

export async function readNativeSaves(): Promise<NativeSave[]> {
  if (isDesktop) return (await database).getAll("nativeSaves");
  return (await import("./storage/browser-native-saves")).readNativeSaves();
}
export async function removeNativeSaves(
  paths: string[] = [],
  gameIds: string[] = [],
) {
  if (!isDesktop)
    return (await import("./storage/browser-native-saves")).removeNativeSaves(
      paths,
      gameIds,
    );
  await (
    await database
  ).transaction(["nativeSaves"], "readwrite", (tx) =>
    removeDesktopNativeSaves(tx, paths, gameIds),
  );
}
export async function removeDesktopNativeSaves(
  tx: Session,
  paths: string[],
  gameIds: string[],
) {
  for (const file of await tx.getAll("nativeSaves"))
    if (paths.includes(file.path) || gameIds.includes(file.gameId))
      await tx.delete("nativeSaves", file.path);
}
export async function writeNativeSaves(
  tx: Session,
  gameId: string,
  files: NativeSavePayload[],
) {
  const prefix = `/data/saves/${gameId}/`;
  for (const file of files) {
    if (
      !file.path.startsWith(prefix) ||
      file.path
        .slice(prefix.length)
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      file.path.includes("\\")
    )
      throw new Error("Invalid save path");
  }
  await removeDesktopNativeSaves(tx, [], [gameId]);
  for (const file of files)
    await tx.put("nativeSaves", {
      path: file.path,
      gameId,
      created: file.created,
      data: new Blob([new Uint8Array(file.data)]),
    });
}
