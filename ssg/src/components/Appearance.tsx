import { useRef, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Check,
  ChevronDown,
  Globe2,
  Laptop,
  Palette,
  Sparkles,
} from "lucide-react";
import { Modal } from "./Modal";
import { translate } from "../lib/i18n";
import {
  getLocale,
  setPreferences,
  usePreferences,
  type Language,
  type Theme,
} from "../lib/preferences";

const themes: {
  id: Theme;
  name: string;
  description: string;
  colors: string[];
}[] = [
  {
    id: "matcha",
    name: "抹茶绿",
    description: "一抹清绿，慢慢放松",
    colors: ["#f0f4ec", "#fdfefb", "#567c43", "#e7efdb"],
  },
  {
    id: "ocean",
    name: "海盐蓝",
    description: "像海风一样，清爽自在",
    colors: ["#edf5fa", "#ffffff", "#267eaa", "#e0f0f6"],
  },
  {
    id: "violet",
    name: "拾光紫",
    description: "柔软的紫，熟悉的快乐",
    colors: ["#f3f3fc", "#ffffff", "#7c59ed", "#ebe5fc"],
  },
  {
    id: "midnight",
    name: "午夜",
    description: "把灯调暗，让冒险发光",
    colors: ["#141622", "#202332", "#b1a0ff", "#303047"],
  },
];

export function Appearance() {
  const { language, theme } = usePreferences();
  const [open, setOpen] = useState(false);
  const themeTrigger = useRef<HTMLButtonElement>(null);
  const current = themes.find((item) => item.id === theme)!;
  const languageLabel =
    language === "system"
      ? translate("系统")
      : language === "zh"
        ? "中文"
        : "English";
  const options = [
    {
      value: "system",
      name: translate("系统"),
      detail: translate("系统默认"),
      icon: Laptop,
    },
    { value: "zh", name: "中文", detail: translate("简体中文"), icon: null },
    { value: "en", name: "English", detail: translate("英文"), icon: null },
  ];

  return (
    <>
      <div className="appearance-actions">
        <Dropdown.Root>
          <Dropdown.Trigger
            className="language-trigger"
            aria-label={translate("切换语言")}
            title={translate("切换语言")}
          >
            <Globe2 size={18} />
            <span>{languageLabel}</span>
            <ChevronDown className="language-chevron" size={13} />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content
              className="dropdown language-menu"
              align="end"
              sideOffset={12}
              collisionPadding={12}
            >
              <Dropdown.Label className="language-menu-title">
                {translate("语言")}
                <span>LANGUAGE</span>
              </Dropdown.Label>
              <Dropdown.RadioGroup
                value={language}
                onValueChange={(value) =>
                  setPreferences({ language: value as Language })
                }
              >
                {options.map(({ value, name, detail, icon: Icon }) => (
                  <Dropdown.RadioItem
                    className="language-option"
                    key={value}
                    value={value}
                    textValue={name}
                  >
                    <span className="language-symbol">
                      {Icon ? <Icon size={19} /> : value === "zh" ? "中" : "En"}
                    </span>
                    <span className="language-option-copy">
                      <strong>{name}</strong>
                      <small>{detail}</small>
                    </span>
                    <Dropdown.ItemIndicator className="language-check">
                      <Check size={17} />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                ))}
              </Dropdown.RadioGroup>
              <div className="language-menu-note">
                <Globe2 size={13} />
                {translate("当前显示：{{value0}}", {
                  value0: getLocale() === "zh-CN" ? "中文" : "English",
                })}
              </div>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
        <span className="appearance-divider" />
        <button
          ref={themeTrigger}
          className="theme-trigger"
          aria-label={translate("切换主题")}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={`${translate("切换主题")} · ${translate(current.name)}`}
          onClick={() => setOpen(true)}
        >
          <Palette size={19} />
          <span>{translate(current.name)}</span>
          <i />
        </button>
      </div>
      {open && (
        <Modal
          autoFocus
          title={translate("给快乐，换个颜色")}
          description={translate("选一种喜欢的氛围，装点你的游戏时光。")}
          className="theme-modal"
          onClose={() => setOpen(false)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            themeTrigger.current?.focus();
          }}
        >
          <div className="theme-intro">
            <Sparkles size={14} />
            {translate("四种心情，随心切换")}
          </div>
          <div
            className="theme-grid"
            role="group"
            aria-label={translate("选择主题")}
          >
            {themes.map((item) => (
              <button
                type="button"
                className={`theme-card ${theme === item.id ? "selected" : ""}`}
                key={item.id}
                aria-pressed={theme === item.id}
                aria-label={translate(item.name)}
                onClick={() => setPreferences({ theme: item.id })}
              >
                <span
                  className="theme-preview"
                  style={
                    {
                      "--preview-bg": item.colors[0],
                      "--preview-panel": item.colors[1],
                      "--preview-accent": item.colors[2],
                      "--preview-soft": item.colors[3],
                    } as React.CSSProperties
                  }
                  aria-hidden="true"
                >
                  <span className="preview-top">
                    <i />
                    <b />
                    <em />
                    <em />
                  </span>
                  <span className="preview-layout">
                    <span className="preview-sidebar">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="preview-main">
                      <span className="preview-banner">
                        <span>
                          <i />
                          <i />
                          <b />
                        </span>
                        <Palette size={33} strokeWidth={1.3} />
                      </span>
                      <span className="preview-cards">
                        <i />
                        <i />
                        <i />
                      </span>
                    </span>
                  </span>
                </span>
                <span className="theme-card-copy">
                  <span>
                    <strong>{translate(item.name)}</strong>
                    <small>{translate(item.description)}</small>
                  </span>
                  <span className="theme-check">
                    {theme === item.id && <Check size={14} strokeWidth={2.7} />}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="theme-modal-footer">
            <span>
              <Check size={14} />
              {translate("选择后立即生效，自动记住你的喜好")}
            </span>
            <button className="button" onClick={() => setOpen(false)}>
              {translate("就用这个")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
