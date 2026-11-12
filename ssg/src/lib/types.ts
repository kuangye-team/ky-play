import { getLocale } from "./preferences";
import { translate } from "./i18n";
export type System =
  | "nes"
  | "snes"
  | "gba"
  | "gb"
  | "gbc"
  | "md"
  | "psx"
  | "psp"
  | "arcade"
  | "ws"
  | "wsc"
  | "nds"
  | "n64";
export type Game = {
  id: string;
  name: string;
  filename: string;
  system: System;
  tags: string[];
  favorite: boolean;
  added: number;
  lastPlayed?: number;
  playSeconds: number;
  size: number;
  hash: string;
  cover?: string;
};
export type Tag = { id: string; name: string; color: string };
export type Save = {
  id: string;
  gameId: string;
  name: string;
  created: number;
  data: Blob;
  screenshot?: string;
  automatic?: boolean;
};
export type Binding = { code: string; label: string };
export type Bindings = Record<string, Binding>;
export const PLAYER_SHORTCUTS = {
  screenshot: { code: "F8", label: "截图" },
  save: { code: "F6", label: "保存进度" },
} as const;
export const SYSTEMS: Record<
  System,
  { name: string; short: string; core: string; color: string }
> = {
  nes: { name: "红白机", short: "NES", core: "fceumm", color: "#ff8d73" },
  snes: { name: "超级任天堂", short: "SNES", core: "snes9x", color: "#8d78ef" },
  gba: {
    name: "Game Boy Advance",
    short: "GBA",
    core: "mgba",
    color: "#61b9d6",
  },
  gb: {
    name: "Game Boy",
    short: "GB",
    core: "gambatte",
    color: "#86aa70",
  },
  gbc: {
    name: "Game Boy Color",
    short: "GBC",
    core: "gambatte",
    color: "#c17bca",
  },
  md: {
    name: "世嘉 Mega Drive",
    short: "MD",
    core: "genesis_plus_gx",
    color: "#5a88b8",
  },
  psx: {
    name: "PlayStation",
    short: "PSX",
    core: "pcsx_rearmed",
    color: "#7280b4",
  },
  psp: {
    name: "PlayStation Portable",
    short: "PSP",
    core: "ppsspp",
    color: "#6299ca",
  },
  arcade: { name: "街机", short: "Arcade", core: "fbneo", color: "#dd8b65" },
  ws: {
    name: "WonderSwan",
    short: "WS",
    core: "mednafen_wswan",
    color: "#8b9b79",
  },
  wsc: {
    name: "WonderSwan Color",
    short: "WSC",
    core: "mednafen_wswan",
    color: "#cf85aa",
  },
  nds: { name: "Nintendo DS", short: "NDS", core: "desmume", color: "#54a99f" },
  n64: {
    name: "Nintendo 64",
    short: "N64",
    core: "mupen64plus_next",
    color: "#e2a04e",
  },
};
export const GAME_EXTENSIONS: Record<string, System> = {
  nes: "nes",
  sfc: "snes",
  smc: "snes",
  gba: "gba",
  gb: "gb",
  gbc: "gbc",
  md: "md",
  gen: "md",
  smd: "md",
  bin: "psx",
  cue: "psx",
  iso: "psx",
  img: "psx",
  chd: "psx",
  pbp: "psx",
  cso: "psp",
  zip: "arcade",
  ws: "ws",
  wsc: "wsc",
  nds: "nds",
  n64: "n64",
  z64: "n64",
  v64: "n64",
};
export const GAME_ACCEPT = Object.keys(GAME_EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(",");
export const ACTIONS = [
  { id: "up", label: "上", index: 4 },
  { id: "down", label: "下", index: 5 },
  { id: "left", label: "左", index: 6 },
  { id: "right", label: "右", index: 7 },
  { id: "a", label: "A", index: 8 },
  { id: "b", label: "B", index: 0 },
  { id: "x", label: "X", index: 9 },
  { id: "y", label: "Y", index: 1 },
  { id: "l", label: "L", index: 10 },
  { id: "r", label: "R", index: 11 },
  { id: "select", label: "选择", index: 2 },
  { id: "start", label: "开始", index: 3 },
];
type Action = { id: string; label: string; index: number; value?: number };
const stickActions = (right = false): Action[] => [
  {
    id: right ? "ru" : "lu",
    label: right ? translate("右摇杆 ↑") : translate("摇杆 ↑"),
    index: right ? 23 : 19,
    value: 32767,
  },
  {
    id: right ? "rd" : "ld",
    label: right ? translate("右摇杆 ↓") : translate("摇杆 ↓"),
    index: right ? 22 : 18,
    value: 32767,
  },
  {
    id: right ? "rl" : "ll",
    label: right ? translate("右摇杆 ←") : translate("摇杆 ←"),
    index: right ? 21 : 17,
    value: 32767,
  },
  {
    id: right ? "rr" : "lr",
    label: right ? translate("右摇杆 →") : translate("摇杆 →"),
    index: right ? 20 : 16,
    value: 32767,
  },
];
function sourceActionsFor(system: System): Action[] {
  if (system === "md")
    return ACTIONS.filter((a) => !["l", "r"].includes(a.id))
      .map((a) => ({
        ...a,
        index:
          ({ a: 1, x: 10, y: 9 } as Record<string, number>)[a.id] ?? a.index,
        label: a.id === "select" ? translate("模式") : a.label,
      }))
      .concat([
        { id: "c", label: "C", index: 8 },
        { id: "z", label: "Z", index: 11 },
      ]);
  if (system === "n64")
    return [
      ...ACTIONS.filter((a) => !["x", "y", "select"].includes(a.id)).map(
        (a) => ({ ...a, index: a.id === "a" ? 0 : a.id === "b" ? 1 : a.index }),
      ),
      { id: "z", label: "Z", index: 12 },
      ...stickActions(),
      ...stickActions(true).map((a) => ({
        ...a,
        label: a.label.replace(translate("右摇杆"), "C"),
      })),
    ];
  if (system === "ws" || system === "wsc")
    return [
      ...ACTIONS.filter((a) =>
        ["up", "down", "left", "right", "a", "b", "start"].includes(a.id),
      ),
      { id: "yu", label: "Y ↑", index: 13 },
      { id: "yd", label: "Y ↓", index: 12 },
      { id: "yl", label: "Y ←", index: 10 },
      { id: "yr", label: "Y →", index: 11 },
    ];
  if (system === "arcade")
    return ACTIONS.map((a) => ({
      ...a,
      label: a.id === "select" ? translate("投币") : a.label,
    }));
  if (system === "psp")
    return [
      ...ACTIONS.map((a) => ({
        ...a,
        label:
          ({ a: "○", b: "×", x: "△", y: "□" } as Record<string, string>)[
            a.id
          ] || a.label,
      })),
      ...stickActions(),
    ];
  if (system === "psx")
    return [
      ...ACTIONS.map((a) => ({
        ...a,
        label:
          (
            { a: "○", b: "×", x: "△", y: "□", l: "L1", r: "R1" } as Record<
              string,
              string
            >
          )[a.id] || a.label,
      })),
      { id: "l2", label: "L2", index: 12 },
      { id: "r2", label: "R2", index: 13 },
      { id: "l3", label: "L3", index: 14 },
      { id: "r3", label: "R3", index: 15 },
      ...stickActions(),
      ...stickActions(true),
    ];
  if (system === "nds")
    return [...ACTIONS, { id: "mic", label: translate("吹气"), index: 14 }];
  return ACTIONS.filter(
    (a) =>
      system === "snes" ||
      (!["x", "y"].includes(a.id) &&
        (system === "gba" || !["l", "r"].includes(a.id))),
  );
}
export const DEFAULT_BINDINGS: Bindings = {
  up: { code: "ArrowUp", label: "↑" },
  down: { code: "ArrowDown", label: "↓" },
  left: { code: "ArrowLeft", label: "←" },
  right: { code: "ArrowRight", label: "→" },
  a: { code: "KeyX", label: "X" },
  b: { code: "KeyZ", label: "Z" },
  x: { code: "KeyS", label: "S" },
  y: { code: "KeyA", label: "A" },
  l: { code: "KeyQ", label: "Q" },
  r: { code: "KeyW", label: "W" },
  select: { code: "ShiftRight", label: "右 Shift" },
  start: { code: "Enter", label: "Enter" },
  c: { code: "KeyC", label: "C" },
  z: { code: "KeyD", label: "D" },
  l2: { code: "KeyE", label: "E" },
  r2: { code: "KeyR", label: "R" },
  l3: { code: "KeyV", label: "V" },
  r3: { code: "KeyB", label: "B" },
  lu: { code: "KeyT", label: "T" },
  ld: { code: "KeyG", label: "G" },
  ll: { code: "KeyF", label: "F" },
  lr: { code: "KeyH", label: "H" },
  ru: { code: "KeyI", label: "I" },
  rd: { code: "KeyK", label: "K" },
  rl: { code: "KeyJ", label: "J" },
  rr: { code: "KeyL", label: "L" },
  yu: { code: "KeyI", label: "I" },
  yd: { code: "KeyK", label: "K" },
  yl: { code: "KeyJ", label: "J" },
  yr: { code: "KeyL", label: "L" },
  mic: { code: "KeyM", label: "M" },
};
export function keyLabel(code: string) {
  return (
    (
      {
        ArrowUp: "↑",
        ArrowDown: "↓",
        ArrowLeft: "←",
        ArrowRight: "→",
        Space: translate("空格"),
        ShiftLeft: translate("左 Shift"),
        ShiftRight: translate("右 Shift"),
        Enter: "Enter",
        Backspace: translate("退格"),
      } as Record<string, string>
    )[code] || code.replace(/^Key|^Digit/, "")
  );
}
export const formatSize = (size: number) => {
  if (size < 1024) return `${Math.max(0, Math.round(size))} B`;
  if (size < 1024 ** 2)
    return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
};
export const formatDate = (time: number) =>
  new Intl.DateTimeFormat(getLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(time);

export function actionsFor(system: System): Action[] {
  return sourceActionsFor(system).map((action) => ({
    ...action,
    label: translate(action.label),
  }));
}

export function bindingLabel(binding?: Binding): string {
  return binding?.code
    ? keyLabel(binding.code)
    : translate(binding?.label || "");
}
