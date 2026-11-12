import { readNativeSaves, type NativeSavePayload } from "../lib/native-saves";
import { getLocale } from "../lib/preferences";
import { translate } from "../lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  Download,
  Gamepad2,
  Image as ImageIcon,
  Keyboard,
  LoaderCircle,
  Maximize,
  Minimize,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Save as SaveIcon,
  Settings2,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  actionsFor,
  bindingLabel,
  DEFAULT_BINDINGS,
  PLAYER_SHORTCUTS,
  SYSTEMS,
  type Bindings,
  type Game,
  type Save,
} from "../lib/types";
import {
  getBindings,
  getRom,
  putGame,
  putSave,
  database,
  download,
} from "../lib/storage";
import { Controller, ControlsPage } from "./Controls";
import { GamepadMonitor } from "./Gamepad";
import { useGamepad } from "../lib/use-gamepad";
import { InputMixer, padInputLabel, type InputValues } from "../lib/gamepad";
import { Modal } from "./Modal";
import { Saves } from "./Saves";
import { GameMenu } from "./GameMenu";
import { getBios } from "../lib/storage-management";
import { isDesktop, openDesktopDevtools } from "../lib/desktop";
type Response = {
  data: Uint8Array;
  screenshot: Uint8Array | null;
  nativeFiles?: NativeSavePayload[];
};
function imageDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error(translate("图片读取失败，请重新截图。")));
    reader.readAsDataURL(blob);
  });
}
export default function Player({
  game,
  initialSave,
  saves,
  onEdit,
  onDelete,
  dialogOpen,
  onClose,
  onRefresh,
  notify,
}: {
  game: Game;
  initialSave?: Save;
  saves: Save[];
  onEdit: () => void;
  onDelete: () => void;
  dialogOpen: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [pageFullscreen, setPageFullscreen] = useState(false);
  const [gameFullscreen, setGameFullscreen] = useState(false);
  const [fullscreenMenu, setFullscreenMenu] = useState(false);
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [saveManagerOpen, setSaveManagerOpen] = useState(false);
  const requests = useRef(
    new Map<
      string,
      {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const [url, setUrl] = useState("");
  const nativeFiles = useRef<NativeSavePayload[]>([]);
  const [biosUrl, setBiosUrl] = useState("");
  const [biosFilename, setBiosFilename] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [screenshot, setScreenshot] = useState<{
    image: Blob;
    preview: string;
    created: number;
  } | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverSet, setCoverSet] = useState(false);
  const [settings, setSettings] = useState<"keyboard" | "gamepad" | null>(null);
  const [restart, setRestart] = useState(false);
  const [tab, setTab] = useState<"keys" | "gamepad" | "saves">("keys");
  const [bindings, setKeys] = useState<Bindings>(DEFAULT_BINDINGS);
  const [pressed, setPressed] = useState(new Set<string>());
  const gamepad = useGamepad(game.system);
  const displayedBindings: Bindings =
    tab === "gamepad"
      ? Object.fromEntries(
          actionsFor(game.system).map((action) => [
            action.id,
            {
              code: "",
              label: gamepad.bindings[action.id]?.[0]
                ? padInputLabel(gamepad.bindings[action.id][0], gamepad.pad)
                : "—",
            },
          ]),
        )
      : bindings;
  const mixer = useRef(new InputMixer());
  const saving = useRef(false);
  const played = useRef(0);
  const interactionBlocked = Boolean(
    settings ||
    restart ||
    screenshot ||
    capturing ||
    fullscreenMenu ||
    gameMenuOpen ||
    saveManagerOpen ||
    dialogOpen,
  );
  const active = ready && !error && !paused && !interactionBlocked;
  const send = useCallback(
    (payload: Record<string, unknown>) =>
      frame.current?.contentWindow?.postMessage(
        { source: "shiguang-app", type: "command", payload },
        location.origin,
      ),
    [],
  );
  const command = useCallback(
    (payload: Record<string, unknown>) =>
      new Promise<any>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          requests.current.delete(id);
          reject(new Error(translate("游戏没有响应，请重试。")));
        }, 10000);
        requests.current.set(id, { resolve, reject, timer });
        frame.current?.contentWindow?.postMessage(
          { source: "shiguang-app", type: "command", id, payload },
          location.origin,
        );
      }),
    [],
  );
  const emitChanges = useCallback(
    (changes: InputValues) => {
      if (!Object.keys(changes).length) return;
      for (const [id, value] of Object.entries(changes)) {
        const action = actionsFor(game.system).find((a) => a.id === id);
        if (action) send({ action: "input", index: action.index, value });
      }
      setPressed(mixer.current.pressed());
    },
    [send, game.system],
  );
  const release = useCallback(() => {
    emitChanges(mixer.current.clear());
  }, [emitChanges]);
  const padValues = useRef(gamepad.values);
  padValues.current = gamepad.values;
  useEffect(() => {
    let frameId = 0;
    const poll = () => {
      emitChanges(
        mixer.current.set(
          "gamepad",
          active && !document.hidden && document.hasFocus()
            ? padValues.current
            : {},
        ),
      );
      frameId = requestAnimationFrame(poll);
    };
    poll();
    return () => {
      cancelAnimationFrame(frameId);
      emitChanges(mixer.current.set("gamepad", {}));
    };
  }, [active, emitChanges]);
  const exitFullscreen = useCallback(() => {
    release();
    if (document.fullscreenElement === screen.current) {
      void document
        .exitFullscreen()
        .catch(() => notify(translate("请按 Esc 退出全屏。")));
    } else {
      setPageFullscreen(false);
    }
  }, [release, notify]);
  const enterGameFullscreen = () => {
    release();
    if (!screen.current?.requestFullscreen) {
      notify(translate("当前浏览器不支持游戏全屏，请使用页面全屏。"));
      return;
    }
    void screen.current
      .requestFullscreen()
      .catch(() => notify(translate("游戏全屏没有打开，请使用页面全屏。")));
  };
  useEffect(() => {
    const changed = () => {
      setGameFullscreen(document.fullscreenElement === screen.current);
      release();
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [release]);
  const input = useCallback(
    (id: string, value: number, source = `touch-${id}`) => {
      if (!active && value) return;
      const action = actionsFor(game.system).find((a) => a.id === id);
      if (!action) return;
      emitChanges(
        mixer.current.set(source, value ? { [id]: action.value ?? 1 } : {}),
      );
    },
    [active, game.system, emitChanges],
  );
  useEffect(() => {
    container.current?.focus();
    let cancelled = false;
    let objectUrl = "";
    let biosObjectUrl = "";
    Promise.all([
      getRom(game),
      game.system === "psx" ? getBios() : Promise.resolve(undefined),
      isDesktop
        ? readNativeSaves().then(files => Promise.all(
            files.filter(file => file.gameId === game.id).map(async file => ({
              path: file.path,
              created: file.created,
              data: new Uint8Array(await file.data.arrayBuffer()),
            })),
          ))
        : Promise.resolve([]),
    ])
      .then(([blob, bios, files]) => {
        if (cancelled) return;
        nativeFiles.current = files;
        if (bios) {
          biosObjectUrl = URL.createObjectURL(bios.data);
          setBiosUrl(biosObjectUrl);
          setBiosFilename(bios.name);
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => setError(e.message));
    getBindings(game.system).then(setKeys);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (biosObjectUrl) URL.revokeObjectURL(biosObjectUrl);
      for (const req of requests.current.values()) {
        clearTimeout(req.timer);
        req.reject(new Error(translate("游戏已关闭")));
      }
      requests.current.clear();
    };
  }, [game.id]);
  useEffect(() => {
    if (ready) {
      send({ action: active ? "resume" : "pause" });
      if (!active) release();
    }
  }, [ready, active, send, release]);
  useEffect(() => {
    if (ready && initialSave)
      initialSave.data
        .arrayBuffer()
        .then((data) => command({ action: "load", data }))
        .then(() => notify(translate("已恢复游戏进度")))
        .catch((e) => notify(e.message));
  }, [ready]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (active) played.current++;
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  const save = useCallback(
    async (automatic = false) => {
      if (!ready || saving.current) return;
      saving.current = true;
      setBusy(true);
      try {
        const result = (await command({ action: "save" })) as Response;
        const screenshot = result.screenshot
          ? await imageDataUrl(
              new Blob([new Uint8Array(result.screenshot)], {
                type: "image/png",
              }),
            )
          : undefined;
        const item: Save = {
          id: automatic ? `auto-${game.id}` : crypto.randomUUID(),
          gameId: game.id,
          name: automatic
            ? translate("离开时的进度")
            : translate("冒险进度 {{value0}}", {
                value0: saves.filter((s) => !s.automatic).length + 1,
              }),
          created: Date.now(),
          data: new Blob([new Uint8Array(result.data)]),
          screenshot,
          automatic,
        };
        await putSave(item, result.nativeFiles);
        await onRefresh();
        setError("");
        if (!automatic) notify(translate("进度已保存"));
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [ready, command, game.id, saves, onRefresh, notify],
  );
  const capture = useCallback(async () => {
    if (!ready || error || busy || capturing || saving.current) return;
    if (document.fullscreenElement === screen.current) {
      try {
        await document.exitFullscreen();
      } catch {
        notify(translate("请先退出游戏全屏，再截图。"));
        return;
      }
    }
    setCapturing(true);
    release();
    try {
      const bytes = (await command({ action: "screenshot" })) as Uint8Array;
      const image = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const preview = await imageDataUrl(image);
      setCoverSet(false);
      setScreenshot({ image, preview, created: Date.now() });
    } catch {
      notify(translate("截图没有完成，请再试一次。"));
    } finally {
      setCapturing(false);
    }
  }, [ready, error, busy, capturing, release, command, notify]);
  const key = useCallback(
    (code: string, down: boolean, repeat = false) => {
      // The focused game frame forwards its keyboard events to this handler.
      if (isDesktop && code === "F12") {
        if (down && !repeat) openDesktopDevtools();
        return;
      }
      if (repeat || interactionBlocked) return;
      if (Object.values(PLAYER_SHORTCUTS).some((item) => item.code === code)) {
        if (!down || !ready || busy || saving.current) return;
        if (code === PLAYER_SHORTCUTS.screenshot.code) void capture();
        if (code === PLAYER_SHORTCUTS.save.code)
          void save().catch((e) => notify(e.message));
        return;
      }
      if (code === "Escape" && down) {
        if (pageFullscreen || gameFullscreen) {
          exitFullscreen();
          return;
        }
        setPaused((v) => !v);
        return;
      }
      for (const a of actionsFor(game.system))
        if (bindings[a.id].code === code)
          input(a.id, down ? 1 : 0, `keyboard-${code}`);
    },
    [
      game.system,
      bindings,
      input,
      interactionBlocked,
      pageFullscreen,
      gameFullscreen,
      exitFullscreen,
      ready,
      busy,
      capture,
      save,
      notify,
    ],
  );
  useEffect(() => {
    const message = (e: MessageEvent) => {
      if (
        e.origin !== location.origin ||
        e.source !== frame.current?.contentWindow ||
        e.data?.source !== "shiguang-player"
      )
        return;
      const data = e.data;
      if (data.type === "ready" && !error) setReady(true);
      if (data.type === "error") {
        setReady(false);
        setError(data.message);
        release();
      }
      if (data.type === "key") key(data.code, data.down, data.repeat);
      if (data.type === "blur") release();
      if (data.type === "response") {
        const request = requests.current.get(data.id);
        if (request) {
          clearTimeout(request.timer);
          requests.current.delete(data.id);
          if (data.error) request.reject(new Error(data.error));
          else request.resolve(data.result);
        }
      }
    };
    const down = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        interactionBlocked ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]:not([contenteditable=false])",
        ) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (
        actionsFor(game.system).some((a) => bindings[a.id].code === e.code) ||
        e.code === "Escape" ||
        Object.values(PLAYER_SHORTCUTS).some((item) => item.code === e.code)
      ) {
        e.preventDefault();
        key(e.code, true, e.repeat);
      }
    };
    const up = (e: KeyboardEvent) => key(e.code, false);
    const blur = () => {
      release();
    };
    const hidden = () => {
      if (document.hidden) {
        setPaused(true);
        release();
      }
    };
    window.addEventListener("message", message);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("message", message);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [key, error, release, bindings, game.system, interactionBlocked]);
  const loadSave = (state: Save) => {
    void state.data
      .arrayBuffer()
      .then((data) => command({ action: "load", data }))
      .then(() => {
        setPaused(false);
        setSaveManagerOpen(false);
        notify(translate("已恢复游戏进度"));
      })
      .catch((e) => notify(e.message));
  };
  const setCover = async () => {
    if (!screenshot || coverBusy || coverSet) return;
    setCoverBusy(true);
    try {
      const db = await database;
      await db.transaction(["games"], "readwrite", async (tx) => {
        const latest = await tx.get("games", game.id);
        if (!latest) throw new Error(translate("游戏不存在"));
        await tx.put("games", { ...latest, cover: screenshot.preview });
      });
      await onRefresh();
      setCoverSet(true);
      notify(translate("已设为游戏封面"));
    } catch {
      notify(translate("封面没有保存成功，请重试。"));
    } finally {
      setCoverBusy(false);
    }
  };
  const exit = async () => {
    if (!ready || error) {
      onClose();
      return;
    }
    try {
      if (ready) {
        await save(true);
        const db = await database;
        const latest = await db.get("games", game.id);
        if (latest)
          await putGame({
            ...latest,
            lastPlayed: Date.now(),
            playSeconds: latest.playSeconds + played.current,
          });
      }
      await onRefresh();
      onClose();
    } catch (e) {
      notify(
        translate("进度未保存：{{value0}}", { value0: (e as Error).message }),
      );
      setError(translate("离开前保存失败。你可以重试保存，或直接返回游戏库。"));
    }
  };
  return (
    <div
      className={`player ${pageFullscreen ? "page-fullscreen" : ""}`}
      ref={container}
      role="dialog"
      aria-modal="true"
      aria-label={translate("{{value0}} 游玩窗口", { value0: game.name })}
      tabIndex={-1}
    >
      <header className="player-header">
        <button
          className="text-button"
          disabled={busy || capturing}
          title={
            ready && !error
              ? translate("返回游戏库，并自动保存当前进度")
              : translate("返回游戏库")
          }
          onClick={() => void exit()}
        >
          <ArrowLeft size={18} />
          {translate("返回游戏库")}
        </button>
        <div>
          <h2>{game.name}</h2>
          <span className={`system-badge ${game.system}`}>
            {SYSTEMS[game.system].short}
          </span>
        </div>
        <GameMenu
          game={game}
          saveCount={saves.length}
          onEdit={onEdit}
          onManageSaves={() => setSaveManagerOpen(true)}
          onDelete={onDelete}
          notify={notify}
          onOpenChange={setGameMenuOpen}
          disabled={busy || capturing}
        />
      </header>
      <div className="player-layout">
        <section className="play-area">
          <div className="game-stage">
            <div
              ref={screen}
              className={`game-screen ${game.system === "nds" ? "nds-screen" : game.system === "psp" ? "psp-screen" : ""}`}
            >
              {url && (
                <iframe
                  ref={frame}
                  title={translate("{{value0}} 游戏画面", {
                    value0: game.name,
                  })}
                  src="/player.html"
                  allow="autoplay; fullscreen; gamepad"
                  onLoad={() =>
                    frame.current?.contentWindow?.postMessage(
                      {
                        source: "shiguang-app",
                        type: "init",
                        config: {
                          desktop: isDesktop,
                          nativeFiles: nativeFiles.current,
                          emulatorBaseUrl: import.meta.env.VITE_EMULATOR_BASE_URL,
                          language: getLocale() === "zh-CN" ? "zh" : "en",
                          url,
                          biosUrl,
                          biosFilename,
                          filename: game.filename,
                          controlScheme:
                            game.system === "md"
                              ? "segaMD"
                              : game.system === "wsc"
                                ? "ws"
                                : game.system === "gbc"
                                  ? "gb"
                                  : game.system,
                          core: SYSTEMS[game.system].core,
                          id: game.id,
                          numericId: Math.abs(
                            [...game.id].reduce(
                              (a, c) => (a * 31 + c.charCodeAt(0)) | 0,
                              0,
                            ),
                          ),
                        },
                      },
                      location.origin,
                    )
                  }
                />
              )}
              {(!ready || error) && (
                <div className="game-overlay">
                  {error ? (
                    <>
                      <Gamepad2 size={40} />
                      <h3>{translate("游戏暂时无法继续")}</h3>
                      <p>{error}</p>
                      <button className="button" onClick={onClose}>
                        {translate("返回游戏库")}
                      </button>
                    </>
                  ) : (
                    <>
                      <LoaderCircle className="spin" size={38} />
                      <h3>{translate("正在唤醒这段回忆…")}</h3>
                      <p>{translate("准备好键盘，马上就能开玩")}</p>
                    </>
                  )}
                </div>
              )}
              {ready && paused && !error && (
                <div className="game-overlay pause-overlay">
                  <Pause size={36} />
                  <h3>{translate("休息一下")}</h3>
                  <button className="button" onClick={() => setPaused(false)}>
                    <Play size={16} />
                    {translate("继续游戏")}
                  </button>
                </div>
              )}
              {gameFullscreen && (
                <button
                  className="exit-game-fullscreen"
                  onClick={exitFullscreen}
                >
                  <Minimize size={17} />
                  {translate("退出游戏全屏")}
                </button>
              )}
            </div>
          </div>
          <div className="player-toolbar">
            <div>
              <button
                className="icon-button"
                aria-label={paused ? translate("继续") : translate("暂停")}
                title={`${paused ? translate("继续") : translate("暂停")}（Esc）`}
                aria-keyshortcuts="Escape"
                disabled={!ready || busy || capturing}
                onClick={() => setPaused((v) => !v)}
              >
                {paused ? <Play /> : <Pause />}
              </button>
              <button
                className="icon-button"
                aria-label={translate("重新开始")}
                disabled={!ready || busy || capturing}
                onClick={() => setRestart(true)}
              >
                <RotateCcw size={19} />
              </button>
              <button
                className="icon-button"
                aria-label={muted ? translate("开启声音") : translate("静音")}
                disabled={!ready}
                onClick={() => {
                  send({ action: "volume", value: muted ? 0.5 : 0 });
                  setMuted(!muted);
                }}
              >
                {muted ? <VolumeX /> : <Volume2 />}
              </button>
            </div>
            <button
              className="button secondary player-action screenshot-button"
              aria-label={capturing ? translate("截图中…") : translate("截图")}
              title={translate("截图（{{value0}}）", {
                value0: PLAYER_SHORTCUTS.screenshot.code,
              })}
              aria-keyshortcuts={PLAYER_SHORTCUTS.screenshot.code}
              disabled={!ready || !!error || busy || capturing}
              onClick={() => void capture()}
            >
              {capturing ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Camera size={16} />
              )}
              {capturing ? translate("截图中…") : translate("截图")}
              <kbd aria-hidden="true">{PLAYER_SHORTCUTS.screenshot.code}</kbd>
            </button>
            <button
              className="button player-action save-progress"
              aria-label={translate("保存进度")}
              title={translate("保存进度（{{value0}}）", {
                value0: PLAYER_SHORTCUTS.save.code,
              })}
              aria-keyshortcuts={PLAYER_SHORTCUTS.save.code}
              disabled={!ready || busy || capturing}
              onClick={() => void save().catch((e) => notify(e.message))}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <SaveIcon size={16} />
              )}
              {translate("保存进度")}
              <kbd aria-hidden="true">{PLAYER_SHORTCUTS.save.code}</kbd>
            </button>
            <Dropdown.Root
              open={fullscreenMenu}
              onOpenChange={(open) => {
                if (open) release();
                setFullscreenMenu(open);
              }}
            >
              <Dropdown.Trigger
                className="icon-button"
                aria-label={translate("全屏模式")}
                title={translate("全屏模式")}
              >
                {pageFullscreen ? (
                  <Minimize size={19} />
                ) : (
                  <Maximize size={19} />
                )}
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content
                  className="dropdown fullscreen-menu"
                  side="top"
                  align="end"
                  sideOffset={10}
                  collisionPadding={12}
                  aria-label={translate("全屏模式")}
                >
                  <Dropdown.Item
                    onSelect={() => {
                      release();
                      setPageFullscreen((value) => !value);
                    }}
                  >
                    <Monitor size={16} />
                    {pageFullscreen
                      ? translate("退出页面全屏")
                      : translate("页面全屏")}
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={enterGameFullscreen}>
                    <Maximize size={16} />
                    {translate("游戏全屏")}
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </section>
        <aside className="play-sidebar">
          <div className="play-tabs">
            <button
              className={tab === "keys" ? "active" : ""}
              aria-pressed={tab === "keys"}
              onClick={() => setTab("keys")}
            >
              <Keyboard size={17} />
              <span>{translate("外设设置")}</span>
            </button>
            <button
              className={tab === "gamepad" ? "active" : ""}
              aria-pressed={tab === "gamepad"}
              onClick={() => setTab("gamepad")}
            >
              <Gamepad2 size={17} />
              <span>{translate("手柄设置")}</span>
            </button>
            <button
              className={tab === "saves" ? "active" : ""}
              aria-pressed={tab === "saves"}
              onClick={() => setTab("saves")}
            >
              <SaveIcon size={17} />
              <span>{translate("我的存档")}</span>
            </button>
          </div>
          <div className="play-sidebar-content" key={tab}>
            {tab === "saves" && (
              <p className="player-save-note">
                <Check size={14} />
                {translate("返回游戏库时，会自动保存当前进度。")}
              </p>
            )}
            {tab !== "saves" ? (
              <>
                {tab === "keys" && (
                  <div className="quick-start">
                    <h3>{translate("准备好，开始冒险")}</h3>
                    <p>
                      {translate("按")}
                      <kbd>{bindingLabel(bindings.start)}</kbd>{" "}
                      {translate("开始冒险，快乐就这么简单。")}
                    </p>
                  </div>
                )}
                {game.system === "nds" && (
                  <p className="touch-tip">
                    {translate("下方屏幕可以直接点击或触摸操作。")}
                  </p>
                )}
                <Controller
                  system={game.system}
                  bindings={displayedBindings}
                  pressed={pressed}
                  onInput={input}
                />
                {tab === "gamepad" && (
                  <GamepadMonitor
                    state={gamepad}
                    system={game.system}
                    compact
                    enabled={active}
                    onSetup={
                      busy || capturing
                        ? undefined
                        : () => setSettings("gamepad")
                    }
                  />
                )}
                <div className="play-bindings">
                  {actionsFor(game.system).map((action) => (
                    <div key={action.id}>
                      <span>{translate(action.label || "")}</span>
                      <kbd>
                        {tab === "gamepad"
                          ? gamepad.bindings[action.id]
                              ?.map((input) =>
                                padInputLabel(input, gamepad.pad),
                              )
                              .join(" / ") || "—"
                          : bindingLabel(bindings[action.id])}
                      </kbd>
                    </div>
                  ))}
                </div>
                {tab === "keys" && (
                  <div
                    className="player-shortcuts"
                    aria-label={translate("游玩快捷键")}
                  >
                    <div>
                      <span>{translate("暂停 / 继续")}</span>
                      <kbd>Esc</kbd>
                    </div>
                    {Object.values(PLAYER_SHORTCUTS).map((shortcut) => (
                      <div key={shortcut.code}>
                        <span>{translate(shortcut.label)}</span>
                        <kbd>{shortcut.code}</kbd>
                      </div>
                    ))}
                    <p>{translate("全屏时，按 Esc 退出全屏。")}</p>
                  </div>
                )}
              </>
            ) : (
              <Saves
                game={game}
                saves={saves}
                onRefresh={onRefresh}
                notify={notify}
                onLoad={loadSave}
              />
            )}
          </div>
          {tab !== "saves" && (
            <div className="play-sidebar-footer">
              <button
                className="button secondary customize-button"
                disabled={busy || capturing}
                onClick={() =>
                  setSettings(tab === "gamepad" ? "gamepad" : "keyboard")
                }
              >
                <Settings2 size={16} />
                {translate("自定义按键")}
                <ChevronRight size={16} />
              </button>
              <div className="input-status">
                <i
                  className={tab === "keys" || gamepad.pad ? "connected" : ""}
                />
                {tab === "keys"
                  ? translate("键盘已准备好，随时开玩")
                  : gamepad.pad
                    ? translate("手柄已连接")
                    : translate("连接手柄，开始游玩")}
              </div>
            </div>
          )}
        </aside>
      </div>
      {saveManagerOpen && (
        <Modal
          title={translate("{{value0}} · 存档", { value0: game.name })}
          description={translate("从熟悉的地方，继续你的冒险。")}
          onClose={() => setSaveManagerOpen(false)}
          wide
        >
          <Saves
            game={game}
            saves={saves}
            onRefresh={onRefresh}
            notify={notify}
            onLoad={loadSave}
          />
        </Modal>
      )}
      {screenshot && (
        <Modal
          title={translate("游戏截图")}
          description={translate(
            "{{value0}} · 留住这一刻，也可以用作游戏封面。",
            { value0: game.name },
          )}
          onClose={() => {
            if (!coverBusy) setScreenshot(null);
          }}
        >
          <div className="screenshot-preview">
            <img
              src={screenshot.preview}
              alt={translate("{{value0}} 截图", { value0: game.name })}
            />
          </div>
          <div className="modal-actions screenshot-actions">
            <button
              className="button secondary"
              onClick={() =>
                download(
                  screenshot.image,
                  `${game.name}-${screenshot.created}.png`,
                )
              }
            >
              <Download size={16} />
              {translate("下载图片")}
            </button>
            <button
              className="button"
              disabled={coverBusy || coverSet}
              onClick={() => void setCover()}
            >
              {coverBusy ? (
                <LoaderCircle className="spin" size={16} />
              ) : coverSet ? (
                <Check size={16} />
              ) : (
                <ImageIcon size={16} />
              )}
              {coverBusy
                ? translate("正在保存…")
                : coverSet
                  ? translate("已设为封面")
                  : translate("设为封面")}
            </button>
          </div>
        </Modal>
      )}
      {settings && (
        <Modal
          title={translate("自定义按键")}
          className="controls-dialog"
          onClose={() => {
            setSettings(null);
            void getBindings(game.system).then(setKeys);
          }}
          wide
        >
          <ControlsPage initial={game.system} initialMode={settings} />
        </Modal>
      )}
      {restart && (
        <Modal
          title={translate("重新开始这次冒险？")}
          description={translate("当前未保存的进度会丢失，已有存档会保留。")}
          onClose={() => setRestart(false)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setRestart(false)}
            >
              {translate("继续玩")}
            </button>
            <button
              className="button"
              onClick={() => {
                send({ action: "restart" });
                setRestart(false);
                setPaused(false);
              }}
            >
              {translate("重新开始")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
