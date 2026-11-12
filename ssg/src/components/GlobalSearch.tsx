import { translate, tagLabel } from "../lib/i18n";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  Gamepad2,
  LoaderCircle,
  Play,
  Search,
  X,
} from "lucide-react";
import { SYSTEMS, type Game, type Save, type Tag } from "../lib/types";

export function GlobalSearch({
  games,
  tags,
  saves,
  loading,
  error,
  triggerRef,
  onClose,
  onStart,
}: {
  games: Game[];
  tags: Tag[];
  saves: Save[];
  loading: boolean;
  error: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onStart: (game: Game) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement);
  const listId = useId();
  const results = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return games
      .filter((game) => {
        const platform = SYSTEMS[game.system];
        const names = tags
          .filter((tag) => game.tags.includes(tag.id))
          .flatMap((tag) => [tag.name, tagLabel(tag)]);
        const text = [
          game.name,
          platform.name,
          translate(platform.name),
          platform.short,
          ...names,
        ]
          .join(" ")
          .toLocaleLowerCase();
        return words.every((word) => text.includes(word));
      })
      .sort(
        (a, b) =>
          (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.added - a.added,
      );
  }, [games, tags, query]);
  const selectedIndex = Math.min(activeIndex, Math.max(0, results.length - 1));
  const savedGames = useMemo(
    () => new Set(saves.map((save) => save.gameId)),
    [saves],
  );

  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, query]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay search-overlay" />
        <Dialog.Content
          className="global-search"
          onEscapeKeyDown={(event) => {
            if (event.isComposing || event.keyCode === 229)
              event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const previous = previousFocus.current;
            if (
              previous instanceof HTMLElement &&
              previous !== document.body &&
              previous.isConnected
            )
              previous.focus();
            else triggerRef.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">
            {translate("搜索游戏")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {translate("搜索整个游戏库，找到喜欢的游戏就开始吧。")}
          </Dialog.Description>
          <div className="search-input-row">
            <Search size={23} aria-hidden="true" />
            <input
              ref={input}
              role="combobox"
              aria-label={translate("搜索游戏")}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={
                results.length ? `${listId}-${selectedIndex}` : undefined
              }
              placeholder={translate("搜一搜，今天想玩什么？")}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229 ||
                  !results.length
                )
                  return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(
                    (selectedIndex +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      results.length) %
                      results.length,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  onStart(results[selectedIndex]);
                }
              }}
            />
            {query && (
              <button
                className="icon-button search-clear"
                aria-label={translate("清空搜索")}
                onClick={() => {
                  setQuery("");
                  setActiveIndex(0);
                  input.current?.focus();
                }}
              >
                <X size={16} />
              </button>
            )}
            <Dialog.Close
              className="search-close"
              aria-label={translate("关闭搜索")}
            >
              <span>Esc</span>
              <X size={18} />
            </Dialog.Close>
          </div>
          <div
            className="search-results-heading"
            role="status"
            aria-live="polite"
          >
            <span>
              {query.trim()
                ? translate("搜索结果")
                : translate("从这里，开启一场冒险")}
            </span>
            <span>
              {loading
                ? translate("正在寻找…")
                : translate("{{value0}} 个游戏", { value0: results.length })}
            </span>
          </div>
          <div
            ref={list}
            id={listId}
            className="search-results"
            role="listbox"
            aria-label={translate("游戏搜索结果")}
            aria-busy={loading}
          >
            {!loading &&
              !error &&
              results.map((game, index) => (
                <div
                  key={game.id}
                  id={`${listId}-${index}`}
                  className="search-result"
                  role="option"
                  aria-selected={index === selectedIndex}
                  onPointerMove={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onStart(game)}
                >
                  <span
                    className="search-result-art"
                    style={{
                      background: `${SYSTEMS[game.system].color}20`,
                      color: SYSTEMS[game.system].color,
                    }}
                  >
                    <Gamepad2 size={25} />
                    {game.cover && (
                      <img
                        src={game.cover}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                  </span>
                  <span className="search-result-copy">
                    <strong>{game.name}</strong>
                    <span>
                      {SYSTEMS[game.system].short}
                      <i />
                      {translate(SYSTEMS[game.system].name)}
                    </span>
                  </span>
                  <span className="search-result-action">
                    {savedGames.has(game.id)
                      ? translate("继续游戏")
                      : translate("开始游戏")}
                    <Play size={14} fill="currentColor" />
                  </span>
                </div>
              ))}
          </div>
          {(loading || error || !results.length) && (
            <div className="search-empty" role="status">
              <span>
                {loading ? (
                  <LoaderCircle size={27} className="spin" />
                ) : (
                  <Search size={27} />
                )}
              </span>
              <strong>
                {loading
                  ? translate("正在打开你的游戏库…")
                  : error
                    ? translate("暂时无法搜索游戏")
                    : query.trim()
                      ? translate("没有找到这个游戏")
                      : translate("你的游戏库还在等第一位伙伴")}
              </strong>
              <p>
                {loading
                  ? translate("稍等片刻，快乐马上就来。")
                  : error ||
                    (query.trim()
                      ? translate("试试游戏名称、平台，或者你给它的标签。")
                      : translate("先从设备添加一款喜欢的游戏吧。"))}
              </p>
            </div>
          )}
          <div className="search-footer">
            <span>{translate("好玩的，都在这里")}</span>
            <div>
              <span>
                <kbd>
                  <ArrowUp size={11} />
                  <ArrowDown size={11} />
                </kbd>
                {translate("选择")}
              </span>
              <span>
                <kbd>
                  <CornerDownLeft size={12} />
                </kbd>
                {translate("开始游戏")}
              </span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
