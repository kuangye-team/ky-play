import { openDB } from "idb";

// EmulatorJS mounts Emscripten's IDBFS here; read only file contents, not directories.
const SAVE_DB = "/data/saves";
const STORE = "FILE_DATA";
async function openNativeSaves() {
  if (
    indexedDB.databases &&
    !(await indexedDB.databases()).some((db) => db.name === SAVE_DB)
  )
    return;
  try {
    const db = await openDB(SAVE_DB, undefined, {
      upgrade(_db, _old, _next, tx) {
        tx.abort();
      },
    });
    if (!db.objectStoreNames.contains(STORE)) {
      db.close();
      return;
    }
    return db;
  } catch (error) {
    if ((error as Error).name !== "AbortError") throw error;
  }
}
export async function readNativeSaves() {
  const db = await openNativeSaves();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, "readonly");
    const files: {
      path: string;
      gameId: string;
      data: Blob;
      created: number;
    }[] = [];
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const value = cursor.value;
      const path = String(cursor.key);
      if (value.contents && (value.mode & 0xf000) === 0x8000) {
        files.push({
          path,
          gameId: path.split("/")[3] || "",
          data: new Blob([value.contents]),
          created: Number(new Date(value.timestamp)) || 0,
        });
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return files;
  } finally {
    db.close();
  }
}
export async function removeNativeSaves(
  paths: string[] = [],
  gameIds: string[] = [],
) {
  const db = await openNativeSaves();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    for (const path of await tx.store.getAllKeys()) {
      if (
        paths.includes(String(path)) ||
        gameIds.some(
          (id) =>
            String(path).startsWith(`${SAVE_DB}/${id}/`) ||
            path === `${SAVE_DB}/${id}`,
        )
      )
        await tx.store.delete(path);
    }
    await tx.done;
  } finally {
    db.close();
  }
}
