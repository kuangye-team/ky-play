import { translate } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Gamepad2, RotateCcw } from "lucide-react";
import { actionsFor, type System } from "../lib/types";
import {
  defaultPadBindings,
  detectPadInput,
  padInputLabel,
  padInputReleased,
  samePadInput,
  STANDARD_BUTTON_NAMES,
  type Pad,
  type PadBindings,
  type PadInput,
} from "../lib/gamepad";
import type { useGamepad } from "../lib/use-gamepad";

type GamepadState = ReturnType<typeof useGamepad>;
const standardNames = STANDARD_BUTTON_NAMES;

export function GamepadMonitor({
  state,
  system,
  compact = false,
  enabled = true,
  onSetup,
}: {
  state: GamepadState;
  system: System;
  compact?: boolean;
  enabled?: boolean;
  onSetup?: () => void;
}) {
  const { pad, values, needsSetup } = state;
  return (
    <section
      className={`gamepad-monitor ${compact ? "compact" : ""}`}
      aria-label={translate("手柄实时状态")}
    >
      <div className="gamepad-heading">
        <Gamepad2 size={20} />
        <strong>
          {pad ? translate("手柄已连接") : translate("连接手柄，试试按键")}
        </strong>
        <span className={`connection ${pad ? "connected" : ""}`}>
          {pad ? translate("已连接") : translate("等待连接")}
        </span>
      </div>
      <p className="gamepad-device">
        {pad?.id ||
          translate("通过 USB 或蓝牙连接后，按一下手柄上的任意按钮。")}
      </p>
      {pad && (
        <>
          <p className="gamepad-hint">
            {needsSetup
              ? translate(
                  "这个手柄需要先设置按键。松开按钮，让摇杆回到中间，再点击「设置手柄」跟着提示操作。",
                )
              : translate("按住按钮，亮起的位置就是你当前的操作。")}
          </p>
          {needsSetup && onSetup && (
            <button className="button secondary" onClick={onSetup}>
              {translate("设置手柄")}
            </button>
          )}
          <div className="gamepad-buttons" aria-label={translate("手柄按钮")}>
            {pad.buttons.map((value, index) => (
              <span
                key={index}
                className={value > 0.5 ? "is-pressed" : ""}
                data-button={index}
                aria-label={`${pad.mapping === "standard" ? standardNames[index] || translate("按钮 {{value0}}", { value0: index + 1 }) : translate("按钮 {{value0}}", { value0: index + 1 })} ${value > 0.5 ? translate("按下") : translate("松开")}`}
              >
                {pad.mapping === "standard"
                  ? standardNames[index] || `B${index}`
                  : `B${index}`}
              </span>
            ))}
          </div>
          {pad.mapping === "standard" && (
            <div className="gamepad-sticks" aria-label={translate("手柄摇杆")}>
              {[0, 2]
                .filter((index) => index + 1 < pad.axes.length)
                .map((index) => (
                  <div className="gamepad-stick" key={index}>
                    <div className="stick-well">
                      <i
                        style={{
                          transform: `translate(${Math.max(-1, Math.min(1, pad.axes[index])) * 14}px, ${Math.max(-1, Math.min(1, pad.axes[index + 1])) * 14}px)`,
                        }}
                      />
                    </div>
                    <span>
                      {index === 0 ? translate("左摇杆") : translate("右摇杆")}
                    </span>
                  </div>
                ))}
            </div>
          )}
          {pad.axes.length > (pad.mapping === "standard" ? 4 : 0) && (
            <div
              className="gamepad-axis-monitor"
              aria-label={translate("摇杆、方向键与扳机")}
            >
              <p className="gamepad-hint">
                {translate(
                  "摇杆、方向键和扳机也可能显示在这里，试着操作，看看哪一项跟着变化。",
                )}
              </p>
              <div className="gamepad-axes">
                {pad.axes.map((value, index) => {
                  if (pad.mapping === "standard" && index < 4) return null;
                  const inRange =
                    Number.isFinite(value) && Math.abs(value) <= 1;
                  return (
                    <div className="gamepad-axis" key={index} data-axis={index}>
                      <span>
                        {translate("输入")}
                        {index + 1}
                      </span>
                      <output
                        aria-label={translate("输入 {{value0}} 当前值", {
                          value0: index + 1,
                        })}
                      >
                        {value.toFixed(2)}
                      </output>
                      <div className="axis-track" aria-hidden="true">
                        {inRange && (
                          <i style={{ left: `${(value + 1) * 50}%` }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <p className="gamepad-output">
            <span>
              {compact ? translate("游戏响应") : translate("对应操作")}
            </span>
            <strong>
              {enabled
                ? actionsFor(system)
                    .filter((action) => values[action.id])
                    .map((action) => action.label)
                    .join(" + ") ||
                  (needsSetup
                    ? translate("请先设置手柄")
                    : translate("等待按键"))
                : translate("游戏已暂停")}
            </strong>
          </p>
          <details className="gamepad-details">
            <summary>{translate("查看按键编号")}</summary>
            <p>{translate("编号与手柄测试页一致，方便核对按键。")}</p>
            <div>
              {pad.buttons.map((value, index) => (
                <code key={index} className={value > 0.5 ? "is-pressed" : ""}>
                  B{index}: {value.toFixed(2)}
                </code>
              ))}
            </div>
            <div>
              {pad.axes.map((value, index) => (
                <code key={index}>
                  AXIS {index}: {value.toFixed(5)}
                </code>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}

export function GamepadSettings({
  state,
  system,
}: {
  state: GamepadState;
  system: System;
}) {
  const { pad, bindings, save, key } = state;
  const actions = actionsFor(system);
  const [listening, setListening] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [draft, setDraft] = useState<PadBindings>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const baseline = useRef<Pad | null>(null);
  const waitingRelease = useRef<PadInput | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const cancel = () => {
    setListening(null);
    setWizard(false);
    waitingRelease.current = null;
  };
  useEffect(() => {
    cancel();
    setMessage("");
  }, [key]);
  useEffect(() => {
    if (!listening) return;
    const escape = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [listening]);
  useEffect(() => {
    if (!pad || !listening || saving) return;
    if (waitingRelease.current) {
      if (!padInputReleased(pad, waitingRelease.current)) return;
      waitingRelease.current = null;
      baseline.current = pad;
      return;
    }
    if (!baseline.current) {
      baseline.current = pad;
      return;
    }
    // A button held when setup opened must be released before it can be assigned.
    baseline.current = {
      ...baseline.current,
      buttons: baseline.current.buttons.map((value, index) =>
        pad.buttons[index] <= 0.5 ? 0 : value,
      ),
    };
    const input = detectPadInput(baseline.current, pad);
    if (!input) return;
    const source = wizard ? draftRef.current : bindings;
    const duplicate = actions.find(
      (action) =>
        action.id !== listening &&
        source[action.id]?.some((item) => samePadInput(item, input)),
    );
    if (duplicate) {
      setMessage(
        translate("这个按钮已用于「{{value0}}」，请换一个按钮。", {
          value0: duplicate.label,
        }),
      );
      waitingRelease.current = input;
      return;
    }
    const next = { ...source, [listening]: [input] };
    const index = actions.findIndex((action) => action.id === listening);
    if (wizard && index < actions.length - 1) {
      setDraft(next);
      waitingRelease.current = input;
      setListening(actions[index + 1].id);
      setMessage("");
    } else {
      setSaving(true);
      void save(next)
        .then(() => {
          cancel();
          setMessage(
            wizard
              ? translate("手柄按键已保存，下次连接可以直接玩。")
              : translate("这个操作的手柄按键已保存。"),
          );
        })
        .catch(() => setMessage(translate("保存失败，请重新按一次试试。")))
        .finally(() => {
          waitingRelease.current = input;
          setSaving(false);
        });
    }
  }, [pad, listening, wizard, saving, bindings, system, save]);
  const start = (id: string, all = false) => {
    if (!pad) return;
    baseline.current = pad;
    waitingRelease.current = null;
    setDraft({});
    setWizard(all);
    setListening(id);
    setMessage("");
  };
  return (
    <div className="gamepad-settings">
      <div className="controls-mapping-header">
        <h3>{translate("手柄按键")}</h3>
        <button
          className="button secondary"
          disabled={!pad || saving}
          onClick={() => start(actions[0].id, true)}
        >
          {translate("设置手柄")}
        </button>
      </div>
      {pad ? (
        <>
          <div
            className={`binding-status ${listening ? "listening" : ""}`}
            role="status"
          >
            {listening
              ? translate(
                  "{{value0}}请先松开按钮，再按下要用于「{{value1}}」的手柄按键。",
                  {
                    value0: wizard
                      ? `${actions.findIndex((action) => action.id === listening) + 1} / ${actions.length} · `
                      : "",
                    value1: actions.find((action) => action.id === listening)
                      ?.label,
                  },
                )
              : translate("点击下方任意一项，也可以单独换键。")}
            {message && <p>{message}</p>}
            {state.error && <p>{state.error}</p>}
          </div>
          <div className="binding-grid gamepad-binding-grid">
            {actions.map((action) => (
              <button
                key={action.id}
                disabled={saving}
                className={listening === action.id ? "listening" : ""}
                onClick={() => start(action.id)}
                aria-label={translate("设置手柄 {{value0}}", {
                  value0: action.label,
                })}
              >
                <span>{translate(action.label || "")}</span>
                <kbd>
                  {listening === action.id
                    ? translate("请按手柄…")
                    : (wizard ? draft[action.id] : bindings[action.id])
                        ?.map((input) => padInputLabel(input, pad))
                        .join(" / ") || translate("待设置")}
                </kbd>
              </button>
            ))}
          </div>
          <p className="gamepad-hint">
            {translate("设置只用于这个手柄和当前平台，键盘按键不受影响。")}
          </p>
          {(listening || pad.mapping === "standard") && (
            <div className="controls-mapping-footer">
              {listening ? (
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={cancel}
                >
                  {translate("取消设置")}
                </button>
              ) : (
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={() => {
                    void save(defaultPadBindings(pad, system))
                      .then(() => setMessage(translate("已恢复标准按键")))
                      .catch(() => setMessage(translate("保存失败，请重试。")));
                  }}
                >
                  <RotateCcw size={14} />
                  {translate("恢复标准按键")}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="gamepad-hint">
          {translate("连接手柄后，就可以在这里调整按键。")}
        </p>
      )}
    </div>
  );
}
