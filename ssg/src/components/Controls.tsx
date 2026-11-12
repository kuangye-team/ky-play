import { translate } from "../lib/i18n";
import { useEffect, useState } from "react";
import { Check, Gamepad2, Keyboard, RotateCcw } from "lucide-react";
import {
  actionsFor,
  DEFAULT_BINDINGS,
  PLAYER_SHORTCUTS,
  keyLabel,
  bindingLabel,
  SYSTEMS,
  type Bindings,
  type System,
} from "../lib/types";
import { getBindings, setBindings } from "../lib/storage";
import { useGamepad } from "../lib/use-gamepad";
import { padInputLabel } from "../lib/gamepad";
import { GamepadMonitor, GamepadSettings } from "./Gamepad";

export function Controller({
  system,
  bindings,
  pressed = new Set(),
  onBind,
  onInput,
}: {
  system: System;
  bindings: Bindings;
  pressed?: Set<string>;
  onBind?: (id: string) => void;
  onInput?: (id: string, value: number) => void;
}) {
  const button = (id: string, label: string) => (
    <button
      type="button"
      key={id}
      className={`pad-key pad-${id} ${pressed.has(id) ? "pressed" : ""}`}
      aria-label={translate("{{value0}} 键 {{value1}}", {
        value0: label,
        value1: bindingLabel(bindings[id]),
      })}
      onClick={() => onBind?.(id)}
      onPointerDown={(e) => {
        if (onInput) {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          onInput(id, 1);
        }
      }}
      onPointerUp={() => onInput?.(id, 0)}
      onPointerCancel={() => onInput?.(id, 0)}
    >
      <span>{translate(label || "")}</span>
      <kbd>{bindingLabel(bindings[id])}</kbd>
    </button>
  );
  const actions = actionsFor(system);
  const label = (id: string) =>
    actions.find((action) => action.id === id)?.label || id;
  const extra = actions.filter(
    (action) =>
      ![
        "up",
        "down",
        "left",
        "right",
        "a",
        "b",
        "x",
        "y",
        "l",
        "r",
        "select",
        "start",
      ].includes(action.id),
  );
  return (
    <>
      <div
        className={`controller-map ${actions.some((action) => action.id === "x") ? "four-buttons" : ""}`}
      >
        {actions.some((action) => action.id === "l") && (
          <div className="shoulders">
            {button("l", label("l"))}
            {button("r", label("r"))}
          </div>
        )}
        <div className="pad-dpad">
          {button("up", "↑")}
          {button("left", "←")}
          <i />
          {button("right", "→")}
          {button("down", "↓")}
        </div>
        <div className="pad-center">
          <Gamepad2 size={24} />
          <small>PLAYER 1</small>
          <div>
            {actions.some((action) => action.id === "select") &&
              button("select", label("select"))}
            {button("start", translate("开始"))}
          </div>
        </div>
        <div className="pad-actions">
          {actions.some((action) => action.id === "x") &&
            button("x", label("x"))}
          {actions.some((action) => action.id === "y") &&
            button("y", label("y"))}
          {button("b", label("b"))}
          {button("a", label("a"))}
        </div>
      </div>
      {extra.length > 0 && (
        <div className="controller-extra">
          {extra.map((action) => button(action.id, action.label))}
        </div>
      )}
    </>
  );
}

export function ControlsPage({
  initial = "nes",
  onChanged,
  initialMode = "keyboard",
}: {
  initial?: System;
  initialMode?: "keyboard" | "gamepad";
  onChanged?: () => void;
}) {
  const [system, setSystem] = useState<System>(initial);
  const [bindings, setKeys] = useState<Bindings>(DEFAULT_BINDINGS);
  const [listening, setListening] = useState<string | null>(null);
  const [draft, setDraft] = useState<Bindings | null>(null);
  const [saving, setSaving] = useState(false);
  const [pressed, setPressed] = useState(new Set<string>());
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState(initialMode);
  const cancel = () => {
    setListening(null);
    setDraft(null);
    setMessage("");
  };
  const start = (id: string, all = false) => {
    if (saving) return;
    setDraft(all ? {} : null);
    setListening(id);
    setMessage("");
    setPressed(new Set());
  };
  const gamepad = useGamepad(system);
  const padLabels = Object.fromEntries(
    actionsFor(system).map((action) => [
      action.id,
      {
        code: "",
        label: gamepad.bindings[action.id]?.[0]
          ? padInputLabel(gamepad.bindings[action.id][0], gamepad.pad)
          : "—",
      },
    ]),
  );
  useEffect(() => {
    getBindings(system).then(setKeys);
    cancel();
    setPressed(new Set());
  }, [system]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (mode !== "keyboard") return;
      if ((event.target as HTMLElement).matches("input,textarea,select"))
        return;
      if (listening) {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || saving) return;
        if (event.code === "Escape") {
          cancel();
          return;
        }
        const shortcut = Object.values(PLAYER_SHORTCUTS).find(
          (item) => item.code === event.code,
        );
        if (shortcut) {
          setMessage(
            translate("这个键已用于「{{value0}}」，请换一个。", {
              value0: translate(shortcut.label),
            }),
          );
          return;
        }
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          [
            "Tab",
            "MetaLeft",
            "MetaRight",
            "ControlLeft",
            "ControlRight",
            "AltLeft",
            "AltRight",
          ].includes(event.code)
        ) {
          setMessage(translate("这个按键留给浏览器使用，请换一个。"));
          return;
        }
        const source = draft ?? bindings;
        const actions = actionsFor(system);
        const other = actions.find(
          (a) => a.id !== listening && source[a.id]?.code === event.code,
        );
        if (other) {
          setMessage(
            translate("这个键已用于「{{value0}}」，请换一个。", {
              value0: other.label,
            }),
          );
          return;
        }
        const next = {
          ...source,
          [listening]: { code: event.code, label: keyLabel(event.code) },
        };
        const index = actions.findIndex((action) => action.id === listening);
        if (draft && index < actions.length - 1) {
          setDraft(next);
          setListening(actions[index + 1].id);
          setMessage("");
          return;
        }
        const saved = { ...bindings, ...next };
        setSaving(true);
        void setBindings(system, saved)
          .then(() => {
            setKeys(saved);
            cancel();
            setMessage(translate("按键已保存"));
            onChanged?.();
          })
          .catch(() => setMessage(translate("保存失败，请重试。")))
          .finally(() => setSaving(false));
        return;
      }
      const found = actionsFor(system).filter(
        (a) => bindings[a.id].code === event.code,
      );
      if (found.length) {
        event.preventDefault();
        setPressed((prev) => new Set([...prev, ...found.map((a) => a.id)]));
      }
    };
    const up = (event: KeyboardEvent) =>
      setPressed(
        (prev) =>
          new Set([...prev].filter((id) => bindings[id].code !== event.code)),
      );
    const blur = () => setPressed(new Set());
    window.addEventListener("keydown", down, !!listening);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, !!listening);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [bindings, listening, draft, saving, system, onChanged, mode]);
  return (
    <div className="controls-page">
      <div className="controls-toolbar">
        <div className="controls-system">
          <span>{translate("平台")}</span>
          <div
            className="platform-options"
            role="group"
            aria-label={translate("选择平台")}
          >
            {Object.entries(SYSTEMS).map(([id, s]) => (
              <button
                key={id}
                type="button"
                className={system === id ? "active" : ""}
                aria-pressed={system === id}
                onClick={() => setSystem(id as System)}
              >
                {s.short}
              </button>
            ))}
          </div>
        </div>
        <div
          className="input-mode-tabs"
          role="group"
          aria-label={translate("选择输入方式")}
        >
          <button
            className={mode === "keyboard" ? "active" : ""}
            aria-pressed={mode === "keyboard"}
            onClick={() => {
              setMode("keyboard");
              cancel();
            }}
          >
            <Keyboard size={17} />
            {translate("键盘")}
          </button>
          <button
            className={mode === "gamepad" ? "active" : ""}
            aria-pressed={mode === "gamepad"}
            onClick={() => {
              setMode("gamepad");
              cancel();
            }}
          >
            <Gamepad2 size={17} />
            {translate("手柄")}
          </button>
        </div>
      </div>
      {mode === "gamepad" ? (
        <div className="controls-workspace">
          <div className="controls-connection">
            <GamepadMonitor state={gamepad} system={system} />
          </div>
          <section
            className="controls-preview"
            aria-label={translate("手柄按键预览")}
          >
            <div className="control-intro">
              <div className="soft-icon">
                <Gamepad2 size={21} />
              </div>
              <div>
                <h3>{translate("试试你的手柄")}</h3>
                <p>{translate("按下手柄按钮，对应的操作会亮起。")}</p>
              </div>
            </div>
            <Controller
              system={system}
              bindings={padLabels}
              pressed={new Set(Object.keys(gamepad.values))}
            />
            <p className="controls-preview-note">
              {SYSTEMS[system].short}
              {translate("· 手柄按键")}
            </p>
          </section>
          <section
            className="controls-mapping"
            aria-label={translate("手柄设置")}
          >
            <GamepadSettings state={gamepad} system={system} />
          </section>
        </div>
      ) : (
        <>
          <div className="controls-workspace">
            <section
              className="controls-preview"
              aria-label={translate("键盘按键预览")}
            >
              <div className="control-intro">
                <div className="soft-icon">
                  <Keyboard size={21} />
                </div>
                <div>
                  <h3>{translate("试试你的按键")}</h3>
                  <p>{translate("按下键盘，对应的按钮会亮起。")}</p>
                </div>
              </div>
              <Controller
                system={system}
                bindings={bindings}
                pressed={pressed}
                onBind={(id) => start(id)}
              />
              <p className="controls-preview-note">
                {translate("也可以点击上方按钮，换成顺手的按键。")}
              </p>
            </section>
            <section
              className="controls-mapping"
              aria-label={translate("键盘按键设置")}
            >
              <div className="controls-mapping-header">
                <h3>{translate("键盘按键")}</h3>
                <button
                  className="button secondary"
                  disabled={saving}
                  onClick={() => start(actionsFor(system)[0].id, true)}
                >
                  {translate("设置按键")}
                </button>
              </div>
              <div
                className={`binding-status ${listening ? "listening" : ""}`}
                role="status"
              >
                {listening
                  ? translate(
                      "{{value0}}{{value1}}请按下要用于「{{value2}}」的新按键，Esc 取消",
                      {
                        value0: message ? message + " " : "",
                        value1: draft
                          ? `${actionsFor(system).findIndex((a) => a.id === listening) + 1} / ${actionsFor(system).length} · `
                          : "",
                        value2: actionsFor(system).find(
                          (a) => a.id === listening,
                        )?.label,
                      },
                    )
                  : message || translate("点击要修改的按键，再按下新的键。")}
              </div>
              <div className="binding-grid">
                {actionsFor(system).map((a) => (
                  <button
                    key={a.id}
                    disabled={saving}
                    className={listening === a.id ? "listening" : ""}
                    onClick={() => start(a.id)}
                  >
                    <span>
                      {translate(a.label || "")}
                      {a.id === "a" && system === "nes"
                        ? translate(" · 跳跃")
                        : a.id === "b" && system === "nes"
                          ? translate(" · 加速 / 攻击")
                          : ""}
                    </span>
                    <kbd>
                      {listening === a.id
                        ? translate("请按键…")
                        : bindingLabel((draft ?? bindings)[a.id]) ||
                          translate("待设置")}
                    </kbd>
                  </button>
                ))}
              </div>
              {listening && (
                <div className="controls-mapping-footer">
                  <button
                    className="text-button"
                    disabled={saving}
                    onClick={cancel}
                  >
                    {translate("取消设置")}
                  </button>
                </div>
              )}
            </section>
          </div>
          <div className="controls-bottom">
            <span>
              <Check size={15} />
              {translate("修改后自动保存，仅用于当前平台")}
            </span>
            <button
              className="text-button"
              disabled={saving}
              onClick={() => {
                void setBindings(system, DEFAULT_BINDINGS).then(() => {
                  setKeys(DEFAULT_BINDINGS);
                  cancel();
                  setPressed(new Set());
                  setMessage(translate("已恢复默认按键"));
                  onChanged?.();
                });
              }}
            >
              <RotateCcw size={14} />
              {translate("恢复默认")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
