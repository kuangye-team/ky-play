import { translate } from "./i18n";
import { actionsFor, type System } from "./types";

export type Pad = {
  id: string;
  index: number;
  mapping: string;
  buttons: number[];
  axes: number[];
};
export type PadInput =
  | { kind: "button"; index: number }
  | { kind: "axis"; index: number; direction: number; rest: number }
  | { kind: "hat"; index: number; direction: number };
export type PadBindings = Record<string, PadInput[]>;
export type InputValues = Record<string, number>;
export const STANDARD_BUTTON_NAMES = [
  "A",
  "B",
  "X",
  "Y",
  "LB",
  "RB",
  "LT",
  "RT",
  "选择",
  "开始",
  "左摇杆",
  "右摇杆",
  "↑",
  "↓",
  "←",
  "→",
  "主页",
];
export const padKey = (pad: Pad, system: System) =>
  `pad-${JSON.stringify([system, pad.id, pad.mapping, pad.buttons.length, pad.axes.length])}`;
const button = (index: number): PadInput => ({ kind: "button", index });
const axis = (index: number, direction: number): PadInput => ({
  kind: "axis",
  index,
  direction,
  rest: 0,
});

export function defaultPadBindings(pad: Pad, system: System): PadBindings {
  if (pad.mapping !== "standard") {
    return {};
  }
  const map: PadBindings = {
    a: [button(0)],
    b: [button(1)],
    x: [button(2)],
    y: [button(3)],
    l: [button(4)],
    r: [button(5)],
    l2: [button(6)],
    r2: [button(7)],
    select: [button(8)],
    start: [button(9)],
    l3: [button(10)],
    r3: [button(11)],
    up: [button(12)],
    down: [button(13)],
    left: [button(14)],
    right: [button(15)],
    lu: [axis(1, -1)],
    ld: [axis(1, 1)],
    ll: [axis(0, -1)],
    lr: [axis(0, 1)],
    ru: [axis(3, -1)],
    rd: [axis(3, 1)],
    rl: [axis(2, -1)],
    rr: [axis(2, 1)],
    yu: [axis(3, -1)],
    yd: [axis(3, 1)],
    yl: [axis(2, -1)],
    yr: [axis(2, 1)],
    c: [button(5)],
    z: [button(6)],
    mic: [button(10)],
  };
  if (["psx", "psp"].includes(system)) {
    map.a = [button(1)];
    map.b = [button(0)];
    map.x = [button(3)];
    map.y = [button(2)];
  }
  if (!actionsFor(system).some((action) => action.id === "lu")) {
    for (const [id, input] of Object.entries({
      up: axis(1, -1),
      down: axis(1, 1),
      left: axis(0, -1),
      right: axis(0, 1),
    }))
      map[id].push(input);
  }
  return map;
}

export function hatDirection(value: number) {
  if (!Number.isFinite(value) || value < -1.01 || value > 1.01) return -1;
  return Math.round((value + 1) * 3.5);
}

export function inputValue(pad: Pad, input: PadInput, analog = false): number {
  if (input.kind === "button")
    return (pad.buttons[input.index] ?? 0) > 0.5 ? 1 : 0;
  const raw = pad.axes[input.index];
  if (!Number.isFinite(raw)) return 0;
  if (input.kind === "hat") {
    const direction = hatDirection(raw);
    return direction >= 0 &&
      [0, 1, 7].includes((direction - input.direction + 8) % 8)
      ? 1
      : 0;
  }
  const value =
    ((raw - input.rest) * input.direction) / (1 - input.rest * input.direction);
  return value > (analog ? 0.18 : 0.5) ? (analog ? Math.min(1, value) : 1) : 0;
}

export function mappedPadValues(
  pad: Pad | null,
  bindings: PadBindings,
  system: System,
): InputValues {
  if (!pad) return {};
  return Object.fromEntries(
    actionsFor(system).flatMap((action) => {
      const value = Math.max(
        0,
        ...(bindings[action.id] || []).map((input) =>
          inputValue(pad, input, !!action.value),
        ),
      );
      return value
        ? [[action.id, Math.round(value * (action.value ?? 1))]]
        : [];
    }),
  );
}

export function detectPadInput(before: Pad, after: Pad): PadInput | null {
  for (let index = 0; index < after.buttons.length; index++)
    if (after.buttons[index] > 0.5 && (before.buttons[index] ?? 0) <= 0.5)
      return button(index);
  for (let index = 0; index < after.axes.length; index++) {
    const rest = before.axes[index];
    const value = after.axes[index];
    if (!Number.isFinite(rest)) continue;
    if (Math.abs(rest) > 1 && hatDirection(value) >= 0)
      return { kind: "hat", index, direction: hatDirection(value) };
    if (Math.abs(value) <= 1 && Math.abs(value - rest) > 0.65)
      return {
        kind: "axis",
        index,
        direction: Math.sign(value - rest),
        rest: Math.abs(rest) < 0.2 ? 0 : rest,
      };
  }
  return null;
}

// Setup must wait for the control to return to rest. A trigger can be captured
// before it reaches the gameplay threshold, and a hat can cross other directions
// without being released.
export function padInputReleased(pad: Pad, input: PadInput): boolean {
  if (input.kind === "button") return (pad.buttons[input.index] ?? 0) <= 0.5;
  const value = pad.axes[input.index];
  if (!Number.isFinite(value)) return true;
  return input.kind === "hat"
    ? hatDirection(value) < 0
    : Math.abs(value - input.rest) < 0.2;
}

export function samePadInput(a: PadInput, b: PadInput): boolean {
  return (
    a.kind === b.kind &&
    a.index === b.index &&
    (a.kind === "button" ||
      (b.kind !== "button" && a.direction === b.direction))
  );
}

export function padInputLabel(input: PadInput, pad?: Pad | null) {
  if (input.kind === "button")
    return pad?.mapping === "standard"
      ? STANDARD_BUTTON_NAMES[input.index] || `B${input.index}`
      : `B${input.index}`;
  if (input.kind === "hat")
    return translate("方向 {{value0}}", {
      value0: ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"][input.direction],
    });
  if (pad?.mapping === "standard" && input.index < 4)
    return translate("{{value0}}摇杆 {{value1}}", {
      value0: input.index < 2 ? translate("左") : translate("右"),
      value1:
        input.index % 2
          ? input.direction > 0
            ? "↓"
            : "↑"
          : input.direction > 0
            ? "→"
            : "←",
    });
  return translate("输入 {{value0}}{{value1}}", {
    value0: input.index + 1,
    value1: input.direction > 0 ? "+" : "−",
  });
}

// Each input source owns its held values; releasing one cannot cancel another.
export class InputMixer {
  private sources = new Map<string, InputValues>();
  private values: InputValues = {};
  set(source: string, values: InputValues): InputValues {
    this.sources.set(source, values);
    const next: InputValues = {};
    for (const sourceValues of this.sources.values())
      for (const [id, value] of Object.entries(sourceValues))
        next[id] = Math.max(next[id] || 0, value);
    const changes: InputValues = {};
    for (const id of new Set([
      ...Object.keys(this.values),
      ...Object.keys(next),
    ]))
      if ((this.values[id] || 0) !== (next[id] || 0))
        changes[id] = next[id] || 0;
    this.values = next;
    return changes;
  }
  clear() {
    this.sources.clear();
    return this.set("", {});
  }
  pressed() {
    return new Set(
      Object.keys(this.values).filter((id) => this.values[id] > 0),
    );
  }
}
