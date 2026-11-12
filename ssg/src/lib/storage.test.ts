import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  database,
  initializeLibrary,
  readLibrary,
  importGame,
  getRom,
  putSave,
  deleteGame,
  deleteTag,
  importSave,
  getBindings,
  setBindings,
} from "./storage";
import { actionsFor, DEFAULT_BINDINGS } from "./types";
import { bundledGames } from "./bundled-game";
const bundledGame = bundledGames[0];
// Bundled ROMs are the only real game fixtures; other formats use synthetic data.
const fixture = () => new File([
  readFileSync(new URL("../../public/game/thwaite.nes", import.meta.url)),
], "thwaite.nes");

// Seed a second library record with the same unmodified ROM for multi-item tests.
async function copyFixture(game: Awaited<ReturnType<typeof importGame>>) {
  const db = await database;
  const copy = { ...game, id: "thwaite-copy", name: "Thwaite test copy" };
  await db.put("games", copy);
  await db.put("roms", await getRom(game), copy.id);
  return copy;
}
beforeEach(async () => {
  const db = await database;
  for (const name of ["games", "roms", "tags", "saves", "settings"] as const)
    await db.clear(name);
  vi.restoreAllMocks();
});
describe("游戏库与存档", () => {
  it("首次打开附带两款游戏，并发初始化不重复，删除后不再添加", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await Promise.all([initializeLibrary(), initializeLibrary()]);
    const library = await readLibrary();
    expect(library.games).toHaveLength(2);
    expect(library.games).toEqual(expect.arrayContaining(bundledGames.map((game) =>
      expect.objectContaining({ id: game.id, name: game.name, system: "nes", hash: game.sha256 }),
    )));
    expect(library.slots).toEqual([...bundledGames.map((game) => game.id), null]);
    expect(library.tags).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
    await deleteGame(bundledGame.id);
    await deleteTag("classic");
    await initializeLibrary();
    expect((await readLibrary()).games.map((game) => game.id)).toEqual([bundledGames[1].id]);
    expect((await readLibrary()).slots).toEqual([null, bundledGames[1].id, null]);
    await deleteGame(bundledGames[1].id);
    await initializeLibrary();
    expect((await readLibrary()).games).toEqual([]);
    expect((await readLibrary()).tags).toHaveLength(2);
    expect(await (await database).count("roms")).toBe(0);
  });
  it("两款游戏并发下载互不混淆，同一游戏请求合并并独立缓存", async () => {
    await initializeLibrary();
    const games = (await readLibrary()).games;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      new Response(readFileSync(new URL(`../../public${url}`, import.meta.url))),
    );
    const loaded = await Promise.all(games.flatMap((game) => [getRom(game), getRom(game)]));
    for (const [index, game] of games.entries()) {
      const record = bundledGames.find((entry) => entry.id === game.id)!;
      const bytes = readFileSync(new URL(`../../public${record.romUrl}`, import.meta.url));
      for (const rom of loaded.slice(index * 2, index * 2 + 2))
        expect(new Uint8Array(await rom.arrayBuffer())).toEqual(new Uint8Array(bytes));
      expect(fetch).toHaveBeenCalledWith(record.romUrl, expect.any(Object));
      await expect(importGame(new File([bytes], "renamed.nes"))).rejects.toThrow("已经在游戏库");
    }
    fetch.mockRejectedValue(new Error("Offline"));
    for (const game of games) expect((await getRom(game)).size).toBe(game.size);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("旧游戏库封面使用内联图片，用户自定义封面与名称保持不变", async () => {
    await initializeLibrary();
    const db = await database;
    const game = (await db.get("games", bundledGame.id))!;
    expect(game.cover).toBe(bundledGame.cover);
    const findGame = async () => (await readLibrary()).games.find((entry) => entry.id === game.id)!;
    expect((await findGame()).cover).toMatch(/^data:image\/png;base64,/);
    const custom = { ...game, name: "我的小镇", cover: "data:image/png;base64,AAAA" };
    await db.put("games", custom);
    expect(await findGame()).toMatchObject(custom);
  });
  it.each(bundledGames)("$name 下载失败或内容损坏时不缓存，重新打开可重试", async (record) => {
    await initializeLibrary();
    const game = (await readLibrary()).games.find((game) => game.id === record.id)!;
    const bytes = readFileSync(new URL(`../../public${record.romUrl}`, import.meta.url));
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes.length)))
      .mockResolvedValueOnce(new Response(bytes));
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(getRom(game)).rejects.toThrow(`${record.name}暂时没有准备好`);
      expect(await (await database).count("roms")).toBe(0);
    }
    expect((await getRom(game)).size).toBe(bytes.length);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("下载期间移除游戏，不会重新留下游戏文件或影响另一款游戏", async () => {
    await initializeLibrary();
    const game = (await readLibrary()).games.find((game) => game.id === bundledGame.id)!;
    let finish!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const loading = getRom(game);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await deleteGame(game.id);
    finish(new Response(readFileSync(new URL("../../public/game/thwaite.nes", import.meta.url))));
    await loading;
    expect(await (await database).count("roms")).toBe(0);
    await initializeLibrary();
    expect((await readLibrary()).games.map((game) => game.id)).toEqual([bundledGames[1].id]);
  });
  it("游戏文件缺失时提示重新添加，不尝试下载游戏", async () => {
    const game = await importGame(fixture());
    await (await database).delete("roms", game.id);
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(getRom(game)).rejects.toThrow("找不到游戏文件，请重新添加");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("Thwaite 能够导入并持久保存，重命名文件不能绕过去重", async () => {
    const file = fixture();
    const game = await importGame(file);
    expect(await (await getRom(game)).arrayBuffer()).toEqual(await file.arrayBuffer());
    expect(game.system).toBe("nes");
    await expect(importGame(new File([file], "renamed.nes"))).rejects.toThrow("已经在游戏库");
    expect((await readLibrary()).games).toHaveLength(1);
  });
  it("拒绝错误扩展名、空文件以及伪造 NES 文件", async () => {
    await expect(importGame(new File(["hello"], "file.rar"))).rejects.toThrow(
      "暂不支持",
    );
    await expect(importGame(new File([], "empty.gb"))).rejects.toThrow(
      "有效游戏",
    );
    await expect(
      importGame(new File(["not a rom"], "fake.nes")),
    ).rejects.toThrow("不是有效");
  });
  it("删除标签会解除游戏关联，删除游戏同时清理文件和存档", async () => {
    const game = await importGame(fixture());
    const db = await database;
    await db.put("tags", { id: "test", name: "标签", color: "#888888" });
    await db.put("games", { ...game, tags: ["test"] });
    await putSave({
      id: "state",
      gameId: game.id,
      name: "进度",
      created: 1,
      data: new Blob(["state"]),
    });
    await deleteTag("test");
    expect((await db.get("games", game.id))?.tags).toEqual([]);
    await deleteGame(game.id);
    expect(await db.get("roms", game.id)).toBeUndefined();
    expect(await db.get("saves", "state")).toBeUndefined();
  });
  it("导入存档校验游戏指纹并完整保存二进制内容", async () => {
    const game = await importGame(fixture());
    const envelope = {
      version: 1,
      gameHash: game.hash,
      system: "nes",
      name: "第一关",
      state: btoa("RASTATE\0\x01\x02"),
    };
    const save = await importSave(
      new File([JSON.stringify(envelope)], "thwaite.kysave"),
      game,
    );
    expect(await save.data.text()).toBe("RASTATE\0\x01\x02");
    expect((await readLibrary()).saves).toHaveLength(1);
    await expect(
      importSave(
        new File(
          [JSON.stringify({ ...envelope, gameHash: "different" })],
          "other.kysave",
        ),
        game,
      ),
    ).rejects.toThrow("另一个游戏");
    await expect(
      importSave(new File(["broken"], "bad.kysave"), game),
    ).rejects.toThrow("无法读取");
  });
  it("每种游戏机独立保存按键，仅展示其实际支持的按钮", async () => {
    await setBindings("nes", {
      ...DEFAULT_BINDINGS,
      a: { code: "KeyJ", label: "J" },
    });
    expect((await getBindings("nes")).a.code).toBe("KeyJ");
    expect((await getBindings("gb")).a.code).toBe("KeyX");
    expect(actionsFor("nes")).toHaveLength(8);
    expect(actionsFor("gba")).toHaveLength(10);
    expect(actionsFor("snes")).toHaveLength(12);
  });
});

describe("新增游戏平台", () => {
  it("识别新增文件扩展名并区分 GB 与 GBC", async () => {
    const { detectSystem } = await import("./storage");
    for (const [ext, system] of Object.entries({
      cso: "psp",
      zip: "arcade",
      ws: "ws",
      wsc: "wsc",
      md: "md",
      gen: "md",
      smd: "md",
      gbc: "gbc",
      gb: "gb",
      chd: "psx",
      pbp: "psx",
      iso: "psx",
      img: "psx",
      cue: "psx",
      bin: "psx",
      nds: "nds",
      n64: "n64",
      z64: "n64",
      v64: "n64",
    }))
      expect(detectSystem(`game.${ext.toUpperCase()}`)).toBe(system);
  });
  it("MD 的 bin 根据 SEGA 标识区分，N64 支持三种字节序", async () => {
    const bytes = new Uint8Array(1024);
    bytes.set(new TextEncoder().encode("SEGA MEGA DRIVE"), 0x100);
    expect((await importGame(new File([bytes], "sega.bin"))).system).toBe("md");
    for (const [ext, header] of [
      ["z64", [128, 55, 18, 64]],
      ["v64", [55, 128, 64, 18]],
      ["n64", [64, 18, 55, 128]],
    ] as const) {
      const data = new Uint8Array(4096);
      data.set(header);
      expect((await importGame(new File([data], `game.${ext}`))).system).toBe(
        "n64",
      );
    }
    await expect(
      importGame(new File([new Uint8Array(4096)], "fake.z64")),
    ).rejects.toThrow("有效的 N64");
  });
  it("NDS 可以导入超过原 64 MB 限制的游戏，内容哈希保持准确", async () => {
    const { createHash } = await import("node:crypto");
    const bytes = new Uint8Array(65 * 1024 ** 2);
    bytes[0] = 42;
    const file = new File([bytes], "large.nds");
    const game = await importGame(file);
    expect(game.size).toBe(file.size);
    expect(game.hash).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
  it("PSX cue 与多个轨道作为一个游戏保存，缺失轨道不导入半张光盘", async () => {
    const { importGames } = await import("./storage");
    const { unzipSync } = await import("fflate");
    const cue = new File(
      [
        'FILE "track1.bin" BINARY\n TRACK 01 MODE2/2352\n INDEX 01 00:00:00\nFILE "track2.bin" BINARY\n TRACK 02 AUDIO\n INDEX 01 00:00:00',
      ],
      "disc.cue",
    );
    const one = new File([new Uint8Array(4096)], "track1.bin");
    const two = new File([new Uint8Array(2048).fill(2)], "track2.bin");
    const failed = await importGames([one, cue]);
    expect(failed).toHaveLength(1);
    expect(failed[0].ok).toBe(false);
    expect((await readLibrary()).games).toHaveLength(0);
    const result = await importGames([two, cue, one]);
    expect(result).toHaveLength(1);
    expect(result[0].ok).toBe(true);
    const game = (await readLibrary()).games[0];
    expect(game.system).toBe("psx");
    expect(game.filename).toBe("disc.zip");
    const blob = await getRom(game);
    expect(game.size).toBe(blob.size);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "disc.cue",
      "track1.bin",
      "track2.bin",
    ]);
    expect(files["track2.bin"]).toEqual(
      new Uint8Array(await two.arrayBuffer()),
    );
    expect((await importGames([cue, one, two]))[0].ok).toBe(false);
  });
  it("新平台按键对应内核，包括 MD C、PSX 肩键和 N64 摇杆", () => {
    expect(actionsFor("gbc")).toHaveLength(8);
    expect(actionsFor("md").find((a) => a.id === "c")?.index).toBe(8);
    expect(actionsFor("psx").find((a) => a.id === "l2")?.index).toBe(12);
    expect(actionsFor("nds").find((a) => a.id === "mic")?.index).toBe(14);
    expect(actionsFor("n64").find((a) => a.id === "a")?.index).toBe(0);
    expect(actionsFor("n64").find((a) => a.id === "lu")).toMatchObject({
      index: 19,
      value: 32767,
    });
    for (const system of [
      "md",
      "psx",
      "nds",
      "n64",
      "psp",
      "arcade",
      "ws",
      "wsc",
    ] as const) {
      const actions = actionsFor(system);
      expect(
        new Set(actions.map((a) => DEFAULT_BINDINGS[a.id].code)).size,
      ).toBe(actions.length);
    }
  });
});

describe("存储管理", () => {
  it("统计导入游戏、截图和封面的实际占用", async () => {
    const { readStorage, textBytes } = await import("./storage-management");
    await initializeLibrary();
    let stats = await readStorage();
    expect(stats.gameBytes).toBe(0);
    await deleteGame(bundledGame.id);
    const db = await database;
    const game = await importGame(fixture());
    await db.put("roms", new Blob([new Uint8Array(4096)]), game.id);
    await db.put("games", { ...game, cover: "data:image/png;base64,AAAA" });
    await putSave({
      id: "manual",
      gameId: game.id,
      name: "第一关",
      created: 1,
      data: new Blob([new Uint8Array(2048)]),
      screenshot: "data:image/png;base64,BBBB",
    });
    stats = await readStorage();
    expect(stats.gameBytes).toBe(4096);
    expect(stats.saveBytes).toBe(
      2048 + textBytes("data:image/png;base64,BBBB"),
    );
    expect(stats.otherBytes).toBe(textBytes("data:image/png;base64,AAAA"));
    expect(stats.totalBytes).toBe(
      stats.gameBytes + stats.saveBytes + stats.otherBytes,
    );
  });
  it("批量清理正确计算关联存档，不重复计数且只删除所选数据", async () => {
    const { cleanStorage, readStorage, cleanupBytes } =
      await import("./storage-management");
    const game = await importGame(fixture());
    const other = await copyFixture(game);
    await putSave({
      id: "a",
      gameId: game.id,
      name: "A",
      created: 1,
      data: new Blob(["123"]),
      automatic: true,
    });
    await putSave({
      id: "b",
      gameId: other.id,
      name: "B",
      created: 1,
      data: new Blob(["12345"]),
    });
    const stats = await readStorage();
    const cleanup = { gameIds: [game.id], saveIds: ["a"] };
    expect(cleanupBytes(stats, cleanup)).toBe(game.size + 3);
    await cleanStorage(cleanup);
    const result = await readStorage();
    expect(result.totalBytes).toBe(other.size + 5);
    expect(result.items.map((item) => item.id).sort()).toEqual(
      [other.id, "b"].sort(),
    );
    await cleanStorage({ saveIds: ["b"] });
    expect((await readStorage()).gameBytes).toBe(other.size);
  });
  it("启动文件计入占用并可以单独移除", async () => {
    const { putBios, readStorage, getBios, cleanStorage } =
      await import("./storage-management");
    await expect(putBios(new File(["bad"], "bad.bin"))).rejects.toThrow(
      "512 KB",
    );
    await putBios(new File([new Uint8Array(512 * 1024)], "scph5501.bin"));
    expect((await readStorage()).otherBytes).toBe(512 * 1024);
    expect((await getBios())?.name).toBe("scph5501.bin");
    await cleanStorage({ bios: true });
    expect((await readStorage()).totalBytes).toBe(0);
  });
});

describe("开始页常玩位置与新增格式", () => {
  it("三个位置独立保存，重复选择移动位置，移除游戏后恢复空位", async () => {
    const { setQuickSlot } = await import("./storage");
    const thwaite = await importGame(fixture());
    const copy = await copyFixture(thwaite);
    expect((await readLibrary()).slots).toEqual([null, null, null]);
    await setQuickSlot(0, thwaite.id);
    await setQuickSlot(2, copy.id);
    expect((await readLibrary()).slots).toEqual([thwaite.id, null, copy.id]);
    await setQuickSlot(1, thwaite.id);
    expect((await readLibrary()).slots).toEqual([null, thwaite.id, copy.id]);
    await setQuickSlot(1, null);
    const { cleanStorage } = await import("./storage-management");
    expect((await readLibrary()).slots).toEqual([null, null, copy.id]);
    await cleanStorage({ gameIds: [copy.id] });
    expect(await (await database).get("settings", "quick-slots")).toEqual([
      null,
      null,
      null,
    ]);
    await setQuickSlot(0, thwaite.id);
    await deleteGame(thwaite.id);
    expect((await readLibrary()).slots).toEqual([null, null, null]);
    await expect(setQuickSlot(3, thwaite.id)).rejects.toThrow("常玩位置");
    await expect(setQuickSlot(0, "missing")).rejects.toThrow("已移除");
  });
  it("ISO 按文件特征区分 PSP 与 PSX，也识别原始光盘扇区", async () => {
    for (const [name, platform, offset, system] of [
      ["psp", "PSP GAME", 16 * 2048, "psp"],
      ["quoted", '\"PSP GAME\"', 16 * 2048, "psp"],
      ["psx", "PLAYSTATION", 16 * 2048, "psx"],
      ["mode1", "PLAYSTATION", 16 * 2352 + 16, "psx"],
      ["mode2", "PLAYSTATION", 16 * 2352 + 24, "psx"],
    ] as const) {
      const iso = new Uint8Array(65536);
      iso.set([1, 67, 68, 48, 48, 49, 1], offset);
      iso.set(new TextEncoder().encode(platform), offset + 8);
      expect((await importGame(new File([iso], `${name}.ISO`))).system).toBe(
        system,
      );
    }
  });
  it("无法识别与损坏的光盘不会误存为 PSX，批量导入继续处理其他游戏", async () => {
    const { importGames } = await import("./storage");
    const unknownIso = new Uint8Array(65536);
    unknownIso.set(new TextEncoder().encode("PSP GAME"), 0x9000);
    const brokenPbp = new Uint8Array(4096);
    brokenPbp.set([0, 80, 66, 80]);
    new DataView(brokenPbp.buffer).setUint32(36, 999999, true);
    const result = await importGames([
      new File([unknownIso], "unknown.iso"),
      new File([brokenPbp], "broken.pbp"),
      fixture(),
    ]);
    expect(result.map((item) => item.ok)).toEqual([false, false, true]);
    expect(result[0].name).toContain("没有识别出游戏平台");
    expect((await readLibrary()).games.map((game) => game.system)).toEqual([
      "nes",
    ]);
  });
  it("PBP 识别独立的 PSP 游戏程序，拒绝倒序或空的内容目录", async () => {
    for (const signature of ["\u007fELF", "~PSP", "~SCE"]) {
      const bytes = new Uint8Array(4096);
      bytes.set([0, 80, 66, 80]);
      const view = new DataView(bytes.buffer);
      for (let offset = 8; offset <= 32; offset += 4)
        view.setUint32(offset, 512, true);
      view.setUint32(36, bytes.length, true);
      bytes.set(new TextEncoder().encode(signature), 512);
      expect(
        (await importGame(new File([bytes], `${signature.slice(1)}.pbp`)))
          .system,
      ).toBe("psp");
      view.setUint32(28, 1024, true);
      await expect(
        importGame(new File([bytes], "reversed.pbp")),
      ).rejects.toThrow("没有识别");
    }
    await expect(
      importGame(new File([new Uint8Array(4096)], "empty.pbp")),
    ).rejects.toThrow("没有识别");
  });
  it("PBP 区分 PSP 与 PSX，街机包保留原文件名和压缩内容", async () => {
    for (const [name, signature, system] of [
      ["psp", "NPUMDIMG", "psp"],
      ["multidisc", "PSTITLEIMG", "psx"],
      ["psx", "PSISOIMG", "psx"],
    ]) {
      const pbp = new Uint8Array(4096);
      pbp.set([0, 80, 66, 80]);
      for (let offset = 8; offset <= 36; offset += 4)
        new DataView(pbp.buffer).setUint32(offset, 512, true);
      pbp.set(new TextEncoder().encode(signature), 512);
      expect((await importGame(new File([pbp], `${name}.pbp`))).system).toBe(
        system,
      );
    }
    const { zipSync } = await import("fflate");
    const file = new File(
      [new Uint8Array(zipSync({ "chip.bin": new Uint8Array([1, 2, 3]) }))],
      "fixture.zip",
    );
    const game = await importGame(file);
    expect(game.system).toBe("arcade");
    expect(game.filename).toBe("fixture.zip");
    expect(await (await getRom(game)).arrayBuffer()).toEqual(
      await file.arrayBuffer(),
    );
    await expect(
      importGame(new File(["not a zip"], "bad.zip")),
    ).rejects.toThrow("街机 ZIP");
  });
});
