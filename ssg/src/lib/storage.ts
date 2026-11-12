import { translate } from "./i18n";
import { isDesktop, saveDesktopFile } from "./desktop";
import { database, maxGameSize } from "./storage/index";
export { database } from "./storage/index";
import {
  removeNativeSaves,
  removeDesktopNativeSaves,
  writeNativeSaves,
  type NativeSavePayload,
} from "./native-saves";
import { createSHA256 } from "hash-wasm";
import { Zip, ZipPassThrough } from "fflate";
import type { Bindings, Game, Save, System } from "./types";
import { DEFAULT_BINDINGS, GAME_EXTENSIONS } from "./types";
import { getBundledGame, initialGames, localizeGame } from "./bundled-game";

export async function initializeLibrary() {
  const db = await database;
  await db.transaction(
    ["settings", "tags", "games"],
    "readwrite",
    async (tx) => {
      if (!(await tx.get("settings", "initialized"))) {
        for (const tag of [
          { id: "classic", name: "童年回忆", color: "#8b6eee" },
          { id: "relax", name: "轻松一下", color: "#50af95" },
          { id: "challenge", name: "挑战通关", color: "#ebaa55" },
        ])
          await tx.put("tags", tag);
        // Seed metadata only; opening the site never waits for a game download.
        const games = initialGames();
        for (const game of games) await tx.put("games", game);
        await tx.put(
          "settings",
          Array.from({ length: 3 }, (_, index) => games[index]?.id ?? null),
          "quick-slots",
        );
        await tx.put("settings", true, "initialized");
      }
    },
  );
}
export async function readLibrary() {
  const db = await database;
  const games = (await db.getAll("games")).map(localizeGame);
  const stored = (await db.get("settings", "quick-slots")) as
    (string | null)[] | undefined;
  return {
    slots: Array.from({ length: 3 }, (_, i) =>
      games.some((game) => game.id === stored?.[i]) ? stored![i] : null,
    ),
    games,
    tags: await db.getAll("tags"),
    saves: await db.getAll("saves"),
  };
}
export async function setQuickSlot(index: number, gameId: string | null) {
  if (!Number.isInteger(index) || index < 0 || index > 2)
    throw new Error(translate("请选择一个常玩位置。"));
  const db = await database;
  await db.transaction(["settings", "games"], "readwrite", async (tx) => {
    if (gameId && !(await tx.get("games", gameId))) {
      throw new Error(translate("这个游戏已移除，请重新选择。"));
    }
    const stored = (await tx.get("settings", "quick-slots")) as
      (string | null)[] | undefined;
    const slots = Array.from({ length: 3 }, (_, i) =>
      i === index
        ? gameId
        : stored?.[i] === gameId
          ? null
          : stored?.[i] || null,
    );
    await tx.put("settings", slots, "quick-slots");
  });
}
export async function putGame(game: Game) {
  await (await database).put("games", game);
}
export async function deleteGame(id: string) {
  if (!isDesktop) await removeNativeSaves([], [id]);
  const db = await database;
  await db.transaction(
    ["games", "roms", "saves", "settings", "nativeSaves"],
    "readwrite",
    async (tx) => {
      if (isDesktop) await removeDesktopNativeSaves(tx, [], [id]);
      const slots = (await tx.get("settings", "quick-slots")) as
        (string | null)[] | undefined;
      if (slots?.includes(id))
        await tx.put(
          "settings",
          slots.map((slot) => (slot === id ? null : slot)),
          "quick-slots",
        );
      await tx.delete("games", id);
      await tx.delete("roms", id);
      for (const key of await tx
        .getAll("saves")
        .then((saves) =>
          saves.filter((save) => save.gameId === id).map((save) => save.id),
        ))
        await tx.delete("saves", key);
    },
  );
}
export async function deleteTag(id: string) {
  const db = await database;
  await db.transaction(["games", "tags"], "readwrite", async (tx) => {
    await tx.delete("tags", id);
    for (const g of await tx.getAll("games"))
      if (g.tags.includes(id))
        await tx.put("games", { ...g, tags: g.tags.filter((t) => t !== id) });
  });
}
export function detectSystem(filename: string): System | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return GAME_EXTENSIONS[ext || ""] || null;
}
export async function hashBlob(blob: Blob) {
  const hash = await createSHA256();
  hash.init();
  for (let offset = 0; offset < blob.size; offset += 4 * 1024 ** 2)
    hash.update(
      new Uint8Array(
        await blob.slice(offset, offset + 4 * 1024 ** 2).arrayBuffer(),
      ),
    );
  return hash.digest();
}
const bundledRomDownloads = new Map<string, Promise<Blob>>();

export async function getRom(game: Game): Promise<Blob> {
  const db = await database;
  const cached = await db.get("roms", game.id);
  if (cached) return cached;
  const bundledGame = getBundledGame(game);
  if (bundledGame) {
    // React StrictMode and quick reopenings may request the same game together.
    const pending = bundledRomDownloads.get(game.id);
    if (pending) return pending;
    const download = (async () => {
      try {
        const response = await fetch(bundledGame.romUrl, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error("Bundled game unavailable");
        const rom = await response.blob();
        if (
          rom.size !== bundledGame.size ||
          (await hashBlob(rom)) !== bundledGame.sha256
        )
          throw new Error("Bundled game does not match its licensed release");
        await db.transaction(["games", "roms"], "readwrite", async (tx) => {
          // Do not recreate orphan files if removed during download.
          if (await tx.get("games", game.id))
            await tx.put("roms", rom, game.id);
        });
        return rom;
      } catch {
        throw new Error(
          translate("{{value0}}暂时没有准备好，请检查网络后重新打开。", {
            value0: localizeGame(game).name,
          }),
        );
      }
    })().finally(() => {
      bundledRomDownloads.delete(game.id);
    });
    bundledRomDownloads.set(game.id, download);
    return download;
  }
  throw new Error(translate("找不到游戏文件，请重新添加。"));
}
async function detectDiscSystem(
  file: File,
  header: Uint8Array,
): Promise<System | null> {
  const decoder = new TextDecoder();
  if (/\.iso$/i.test(file.name)) {
    // ISO 9660 primary volume descriptor: cooked sectors, or raw Mode 1 / Mode 2.
    for (const offset of [16 * 2048, 16 * 2352 + 16, 16 * 2352 + 24]) {
      const volume = new Uint8Array(
        await file.slice(offset, offset + 40).arrayBuffer(),
      );
      if (
        volume[0] !== 1 ||
        decoder.decode(volume.slice(1, 6)) !== "CD001" ||
        volume[6] !== 1
      )
        continue;
      const platform = decoder
        .decode(volume.slice(8, 40))
        .replace(/\0/g, "")
        .trim();
      if (platform === "PSP GAME" || platform === '"PSP GAME"') return "psp";
      if (platform === "PLAYSTATION") return "psx";
    }
    return null;
  }
  if (header.length < 40 || decoder.decode(header.slice(0, 4)) !== "\0PBP")
    return null;
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  let previous = 40;
  for (let index = 8; index <= 36; index += 4) {
    const offset = view.getUint32(index, true);
    if (offset < previous || offset > file.size) return null;
    previous = offset;
  }
  const archiveOffset = view.getUint32(36, true);
  const archive = decoder.decode(
    await file.slice(archiveOffset, archiveOffset + 16).arrayBuffer(),
  );
  if (archive.startsWith("PSISOIMG") || archive.startsWith("PSTITLEIMG"))
    return "psx";
  const executableOffset = view.getUint32(32, true);
  const executable = decoder.decode(
    await file.slice(executableOffset, executableOffset + 4).arrayBuffer(),
  );
  if (
    archive.startsWith("NPUMDIMG") ||
    (executableOffset + 4 <= archiveOffset &&
      ["~PSP", "\u007fELF", "~SCE"].includes(executable))
  )
    return "psp";
  return null;
}
export async function importGame(file: File) {
  let system = detectSystem(file.name);
  if (!system)
    throw new Error(
      translate("{{value0}}：暂不支持这个格式，请先解压游戏文件。", {
        value0: file.name,
      }),
    );
  if (file.name.toLowerCase().endsWith(".cue"))
    throw new Error(
      translate("{{value0}}：请同时选择这张光盘的 .cue 和全部 .bin 文件。", {
        value0: file.name,
      }),
    );
  if (!file.size || file.size > maxGameSize)
    throw new Error(
      translate(
        isDesktop
          ? "{{value0}}：请选择有效的游戏文件。"
          : "{{value0}}：请选择不超过 1 GB 的有效游戏文件。",
        {
          value0: file.name,
        },
      ),
    );
  const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "iso" || ext === "pbp") {
    system = await detectDiscSystem(file, bytes);
    if (!system)
      throw new Error(
        translate(
          "{{value0}}：没有识别出游戏平台，请选择完整的 PSP 或 PSX 游戏文件。",
          { value0: file.name },
        ),
      );
  }
  if (
    system === "arcade" &&
    !(bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4)
  )
    throw new Error(
      translate("{{value0}}：请选择完整的街机 ZIP 游戏包，无需解压。", {
        value0: file.name,
      }),
    );
  if (
    file.name.toLowerCase().endsWith(".bin") &&
    new TextDecoder().decode(bytes.slice(0x100, 0x110)).includes("SEGA")
  )
    system = "md";
  if (
    system === "nes" &&
    !(bytes[0] === 78 && bytes[1] === 69 && bytes[2] === 83 && bytes[3] === 26)
  )
    throw new Error(
      translate("{{value0}}：这不是有效的红白机游戏。", { value0: file.name }),
    );
  if (
    (["gb", "gbc"].includes(system) && file.size < 0x150) ||
    (system === "gba" && file.size < 0xc0) ||
    (system === "snes" && file.size < 32768) ||
    (["md", "nds"].includes(system) && file.size < 512) ||
    (["psx", "psp"].includes(system) && file.size < 2048) ||
    (["ws", "wsc"].includes(system) && file.size < 512)
  )
    throw new Error(
      translate("{{value0}}：游戏文件不完整。", { value0: file.name }),
    );
  if (
    system === "n64" &&
    (file.size < 4096 ||
      !["128,55,18,64", "55,128,64,18", "64,18,55,128"].includes(
        Array.from(bytes.slice(0, 4)).join(","),
      ))
  )
    throw new Error(
      translate("{{value0}}：这不是有效的 N64 游戏。", { value0: file.name }),
    );
  return persistGame(file, system);
}
async function persistGame(
  file: File,
  system: System,
  name = file.name.replace(/\.[^.]+$/, ""),
) {
  if (file.size > maxGameSize)
    throw new Error(translate("一张光盘的文件合计不能超过 1 GB。"));
  const hash = await hashBlob(file);
  const db = await database;
  for (const existing of await db.getAll("games")) {
    if (existing.size !== file.size) continue;
    if (existing.hash === hash)
      throw new Error(
        translate("「{{value0}}」已经在游戏库里了。", {
          value0: existing.name,
        }),
      );
  }
  const game: Game = {
    id: crypto.randomUUID(),
    name,
    filename: file.name,
    system,
    tags: [],
    favorite: false,
    added: Date.now(),
    playSeconds: 0,
    size: file.size,
    hash,
  };
  await db.transaction(["roms", "games"], "readwrite", async (tx) => {
    await tx.put("roms", file, game.id);
    await tx.put("games", game);
  });
  return game;
}
export async function importGames(files: File[]) {
  const results: { name: string; ok: boolean }[] = [];
  const consumed = new Set<File>();
  for (const cue of files.filter((file) => /\.cue$/i.test(file.name))) {
    consumed.add(cue);
    try {
      if (cue.size > 1024 ** 2)
        throw new Error(translate("光盘目录文件过大，请重新选择。"));
      const content = await cue.text();
      const names = [
        ...content.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+\S+/gim),
      ].map((match) => match[1] || match[2]);
      if (!names.length)
        throw new Error(translate("光盘目录里没有找到游戏文件。"));
      const entries: [string, File][] = [[cue.name, cue]];
      const missing: string[] = [];
      for (const name of new Set(names)) {
        if (/[\\/]/.test(name) || name === "..")
          throw new Error(
            translate("请将光盘的 .cue 和 .bin 文件放在同一文件夹后重新选择。"),
          );
        const track = files.find(
          (file) => file.name.toLowerCase() === name.toLowerCase(),
        );
        if (!track) missing.push(name);
        else {
          consumed.add(track);
          entries.push([name, track]);
        }
      }
      if (missing.length)
        throw new Error(
          translate("还缺少 {{value0}}，请与 .cue 文件一起选择。", {
            value0: missing.join("、"),
          }),
        );
      if (entries.some(([, file]) => !file.size))
        throw new Error(translate("光盘文件为空，请重新选择。"));
      if (
        entries.reduce((sum, [, file]) => sum + file.size, 0) >
        maxGameSize - 1024 ** 2
      )
        throw new Error(translate("一张光盘的文件合计不能超过 1 GB。"));
      const chunks: BlobPart[] = [];
      const archive = new Zip((error, data) => {
        if (error) throw error;
        chunks.push(new Uint8Array(data));
      });
      for (const [name, file] of entries) {
        const entry = new ZipPassThrough(name);
        entry.mtime = new Date(2000, 0, 1);
        archive.add(entry);
        for (let offset = 0; offset < file.size; offset += 4 * 1024 ** 2) {
          const end = Math.min(file.size, offset + 4 * 1024 ** 2);
          entry.push(
            new Uint8Array(await file.slice(offset, end).arrayBuffer()),
            end === file.size,
          );
        }
      }
      archive.end();
      const game = await persistGame(
        new File(chunks, cue.name.replace(/\.cue$/i, ".zip")),
        "psx",
        cue.name.replace(/\.cue$/i, ""),
      );
      results.push({
        name: translate("{{value0}} · 已加入游戏库", { value0: game.name }),
        ok: true,
      });
    } catch (error) {
      results.push({ name: `${cue.name}：${importError(error)}`, ok: false });
    }
  }
  for (const file of files.filter((file) => !consumed.has(file))) {
    try {
      const game = await importGame(file);
      results.push({
        name: translate("{{value0}} · 已加入游戏库", { value0: game.name }),
        ok: true,
      });
    } catch (error) {
      results.push({ name: importError(error), ok: false });
    }
  }
  return results;
}
function importError(error: unknown) {
  return (error as Error).name === "QuotaExceededError"
    ? translate("空间不足，请到「存储管理」清理一些文件后重试。")
    : (error as Error).message || translate("添加失败，请重试。");
}
export async function getBindings(system: System): Promise<Bindings> {
  return {
    ...DEFAULT_BINDINGS,
    ...(((await (
      await database
    ).get("settings", `keys-${system}`)) as Bindings) || {}),
  };
}
export async function setBindings(system: System, bindings: Bindings) {
  await (await database).put("settings", bindings, `keys-${system}`);
}
export async function putSave(save: Save, nativeFiles?: NativeSavePayload[]) {
  await (
    await database
  ).transaction(["games", "saves", "nativeSaves"], "readwrite", async (tx) => {
    if (isDesktop && nativeFiles) {
      if (!(await tx.get("games", save.gameId)))
        throw new Error(translate("游戏不存在"));
      await writeNativeSaves(tx, save.gameId, nativeFiles);
    }
    await tx.put("saves", save);
  });
}
export async function removeSave(id: string) {
  await (await database).delete("saves", id);
}
export async function download(blob: Blob, filename: string) {
  if (isDesktop) {
    try {
      await saveDesktopFile(blob, filename);
    } catch {
      const { message } = await import("@tauri-apps/plugin-dialog");
      await message(translate("文件未能导出，请重试。"), { kind: "error" });
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
export async function exportSave(save: Save, game: Game) {
  const bytes = new Uint8Array(await save.data.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  await download(
    new Blob(
      [
        JSON.stringify({
          version: 1,
          gameHash: game.hash,
          system: game.system,
          name: save.name,
          created: save.created,
          state: btoa(binary),
          screenshot: save.screenshot,
        }),
      ],
      { type: "application/json" },
    ),
    `${game.name}-${save.name}.kysave`,
  );
}
export async function importSave(file: File, game: Game) {
  if (file.size > 256 * 1024 * 1024)
    throw new Error(translate("存档文件过大，请重新选择。"));
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(
      translate("无法读取这个存档，请选择从拾光导出的 .kysave 文件。"),
    );
  }
  if (
    data.version !== 1 ||
    typeof data.state !== "string" ||
    !data.state.length
  )
    throw new Error(translate("存档文件不完整。"));
  if (data.gameHash !== game.hash || data.system !== game.system)
    throw new Error(translate("这个存档属于另一个游戏，请选择对应的游戏。"));
  let binary;
  try {
    binary = atob(data.state);
  } catch {
    throw new Error(translate("存档内容损坏，无法导入。"));
  }
  const save: Save = {
    id: crypto.randomUUID(),
    gameId: game.id,
    name:
      typeof data.name === "string"
        ? data.name.slice(0, 60)
        : translate("导入的存档"),
    created: Date.now(),
    data: new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))]),
    screenshot:
      typeof data.screenshot === "string" &&
      data.screenshot.startsWith("data:image/png;base64,")
        ? data.screenshot
        : undefined,
  };
  await putSave(save);
  return save;
}
