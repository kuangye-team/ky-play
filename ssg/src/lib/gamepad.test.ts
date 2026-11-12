import { describe, expect, it } from "vitest";
import {
  defaultPadBindings,
  detectPadInput,
  InputMixer,
  mappedPadValues,
  padInputReleased,
  padKey,
  samePadInput,
  type Pad,
} from "./gamepad";

const pad = (mapping = "standard"): Pad => ({
  id: "Test controller",
  index: 0,
  mapping,
  buttons: Array(17).fill(0),
  axes: [0, 0, 0, 0],
});

describe("gamepad mapping", () => {
  it("maps the standard NES buttons and leaves triggers unused", () => {
    const device = pad();
    const bindings = defaultPadBindings(device, "nes");
    for (const [index, action] of [
      [0, "a"],
      [1, "b"],
      [8, "select"],
      [9, "start"],
      [12, "up"],
      [13, "down"],
      [14, "left"],
      [15, "right"],
    ] as const) {
      device.buttons.fill(0);
      device.buttons[index] = 1;
      expect(mappedPadValues(device, bindings, "nes")).toEqual({ [action]: 1 });
    }
    device.buttons.fill(0);
    device.buttons[7] = 1;
    expect(mappedPadValues(device, bindings, "nes")).toEqual({});
  });
  it("uses a dead zone, supports diagonals and returns to neutral", () => {
    const device = pad();
    const bindings = defaultPadBindings(device, "nes");
    device.axes = [0.12, -0.19, 0, 0];
    expect(mappedPadValues(device, bindings, "nes")).toEqual({});
    device.axes = [0.9, -0.8, 0, 0];
    expect(mappedPadValues(device, bindings, "nes")).toEqual({
      right: 1,
      up: 1,
    });
    device.axes = [-0.9, 0, 0, 0];
    expect(mappedPadValues(device, bindings, "nes")).toEqual({ left: 1 });
    expect(mappedPadValues(null, bindings, "nes")).toEqual({});
  });
  it("does not guess nonstandard buttons; calibration supports raw buttons and hats", () => {
    const before = pad("");
    before.axes[9] = 1.29;
    const after = structuredClone(before);
    after.axes[9] = -1;
    expect(defaultPadBindings(before, "nes")).toEqual({});
    const input = detectPadInput(before, after)!;
    expect(input).toEqual({ kind: "hat", index: 9, direction: 0 });
    after.axes[9] = -0.71;
    expect(mappedPadValues(after, { up: [input] }, "nes")).toEqual({ up: 1 });
    after.axes[9] = 1.29;
    expect(mappedPadValues(after, { up: [input] }, "nes")).toEqual({});
    after.buttons[11] = 1;
    expect(detectPadInput(before, after)).toEqual({
      kind: "button",
      index: 11,
    });
    expect(
      mappedPadValues(after, { start: [{ kind: "button", index: 11 }] }, "nes"),
    ).toEqual({ start: 1 });
  });
  it("retains analog strength for N64 without also moving the d-pad", () => {
    const device = pad();
    device.axes[0] = 0.6;
    expect(
      mappedPadValues(device, defaultPadBindings(device, "n64"), "n64"),
    ).toEqual({ lr: Math.round(32767 * 0.6) });
  });
  it("captures every BETOP hat direction, including diagonals, and releases at 3.28571", () => {
    const before = pad("");
    before.axes = [
      0.00392, 0.00392, 0.0902, -1, -1, -0.02745, 0, 0, 0, 3.28571,
    ];
    const bindings = {
      up: [{ kind: "hat", index: 9, direction: 0 }],
      right: [{ kind: "hat", index: 9, direction: 2 }],
      down: [{ kind: "hat", index: 9, direction: 4 }],
      left: [{ kind: "hat", index: 9, direction: 6 }],
    } as const;
    const map = Object.fromEntries(
      Object.entries(bindings).map(([key, inputs]) => [key, [...inputs]]),
    );
    const expected = [
      { up: 1 },
      { up: 1, right: 1 },
      { right: 1 },
      { down: 1, right: 1 },
      { down: 1 },
      { down: 1, left: 1 },
      { left: 1 },
      { up: 1, left: 1 },
    ];
    for (let direction = 0; direction < 8; direction++) {
      const after = structuredClone(before);
      after.axes[9] = Number((direction / 3.5 - 1).toFixed(5));
      expect(detectPadInput(before, after)).toEqual({
        kind: "hat",
        index: 9,
        direction,
      });
      expect(mappedPadValues(after, map, "nes")).toEqual(expected[direction]);
      expect(padInputReleased(after, map.up[0])).toBe(false);
    }
    expect(mappedPadValues(before, map, "nes")).toEqual({});
    expect(padInputReleased(before, map.up[0])).toBe(true);
  });
  it("captures the right stick beyond the first four axes and waits for neutral", () => {
    const before = pad("");
    before.axes = [
      0.00392, 0.00392, 0.0902, -1, -1, -0.02745, 0, 0, 0, 3.28571,
    ];
    for (const direction of [-1, 1]) {
      const after = structuredClone(before);
      after.axes[5] = direction;
      const input = detectPadInput(before, after)!;
      expect(input).toEqual({ kind: "axis", index: 5, direction, rest: 0 });
      expect(mappedPadValues(after, { a: [input] }, "nes")).toEqual({ a: 1 });
      after.axes[5] = direction * 0.4;
      expect(padInputReleased(after, input)).toBe(false);
      expect(padInputReleased(before, input)).toBe(true);
      expect(mappedPadValues(before, { a: [input] }, "nes")).toEqual({});
    }
  });
  it("does not mistake a partially pressed trigger for a released control during setup", () => {
    const before = pad("");
    before.axes[3] = -1;
    const after = structuredClone(before);
    after.axes[3] = -0.3;
    const input = detectPadInput(before, after)!;
    expect(input).toEqual({ kind: "axis", index: 3, direction: 1, rest: -1 });
    expect(padInputReleased(after, input)).toBe(false);
    after.axes[3] = 1;
    expect(mappedPadValues(after, { a: [input] }, "nes")).toEqual({ a: 1 });
    expect(padInputReleased(before, input)).toBe(true);
    expect(
      samePadInput(input, { ...input, kind: "axis", direction: 1, rest: -0.9 }),
    ).toBe(true);
    expect(
      samePadInput(input, { kind: "axis", index: 3, direction: -1, rest: -1 }),
    ).toBe(false);
  });
  it("keeps calibration independent of connection slot and scoped to layout and system", () => {
    const device = pad();
    expect(padKey(device, "nes")).toBe(padKey({ ...device, index: 3 }, "nes"));
    expect(padKey(device, "nes")).not.toBe(
      padKey({ ...device, mapping: "" }, "nes"),
    );
    expect(padKey(device, "nes")).not.toBe(padKey(device, "nds"));
  });
});

describe("input ownership", () => {
  it("does not release a game action until all sources let go", () => {
    const mixer = new InputMixer();
    expect(mixer.set("keyboard", { a: 1 })).toEqual({ a: 1 });
    expect(mixer.set("gamepad", { a: 1, right: 1 })).toEqual({ right: 1 });
    expect(mixer.set("gamepad", {})).toEqual({ right: 0 });
    expect(mixer.pressed()).toEqual(new Set(["a"]));
    expect(mixer.clear()).toEqual({ a: 0 });
    expect(mixer.pressed().size).toBe(0);
  });
  it("releases old directions and only emits changes", () => {
    const mixer = new InputMixer();
    mixer.set("gamepad", { right: 1 });
    expect(mixer.set("gamepad", { left: 1 })).toEqual({ right: 0, left: 1 });
    expect(mixer.set("gamepad", { left: 1 })).toEqual({});
    expect(mixer.set("gamepad", {})).toEqual({ left: 0 });
  });
});
