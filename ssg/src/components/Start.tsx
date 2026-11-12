import { translate } from "../lib/i18n";
import { controllerImage } from "virtual:app-assets";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  Gamepad2,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Search,
  Shuffle,
  X,
} from "lucide-react";
import { SYSTEMS, type Game, type Save as GameSave } from "../lib/types";
import { Modal } from "./Modal";

type Props = {
  games: Game[];
  saves: GameSave[];
  slots: (string | null)[];
  loading: boolean;
  error: string;
  onStart: (game: Game) => void;
  onSlot: (index: number, id: string | null) => Promise<void>;
  onNavigate: (
    page: "library" | "recent" | "favorites" | "saves" | "controls",
  ) => void;
  onUpload: () => void;
};

function GameArt({ game }: { game: Game }) {
  return (
    <span
      className="start-game-art"
      style={{
        background: `linear-gradient(135deg, ${SYSTEMS[game.system].color}25, ${SYSTEMS[game.system].color}50)`,
      }}
    >
      <Gamepad2 size={46} strokeWidth={1.2} />
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
  );
}

function GameLaunch({
  game,
  index,
  hasSave,
  label,
  onStart,
}: {
  game: Game;
  index: number;
  hasSave: boolean;
  label: string;
  onStart: (game: Game) => void;
}) {
  return (
    <button
      className="slot-launch"
      aria-label={translate(label || "")}
      onClick={() => onStart(game)}
    >
      <GameArt game={game} />
      <span className="slot-number">0{index + 1}</span>
      <span className="slot-info">
        <small>{SYSTEMS[game.system].short}</small>
        <strong>{game.name}</strong>
        <span>
          {hasSave ? translate("继续游戏") : translate("开始游戏")}
          <Play size={12} fill="currentColor" />
        </span>
      </span>
    </button>
  );
}

export function StartPage({
  games,
  saves,
  slots,
  loading,
  error,
  onStart,
  onSlot,
  onNavigate,
  onUpload,
}: Props) {
  const [choosing, setChoosing] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [slotError, setSlotError] = useState("");
  const recent = games
    .filter((game) => game.lastPlayed)
    .sort((a, b) => b.lastPlayed! - a.lastPlayed!)
    .slice(0, 3);
  const firstGame = recent[0] || games[0];
  const hasSave = (id: string) => saves.some((save) => save.gameId === id);
  const choose = (index: number) => {
    setChoosing(index);
    setQuery("");
    setSlotError("");
  };
  const saveSlot = async (id: string | null) => {
    if (choosing === null || busy) return;
    setBusy(true);
    try {
      await onSlot(choosing, id);
      setChoosing(null);
    } catch {
      setSlotError(translate("常玩游戏没有保存成功，请重试。"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="start-page">
      <section className="welcome-banner">
        <div className="banner-copy">
          <span className="eyebrow">
            <span /> PRESS START, FEEL HAPPY
          </span>
          <h2>
            {translate("因过竹院逢僧话，")}
            <br />
            {translate("偷得浮生半日闲。")}
            <span className="title-spark">✦</span>
          </h2>
          <p>
            {translate("熟悉的像素，简单的快乐。")}
            <br />
            {translate("别来无恙，那些未完的故事。")}
          </p>
          <div className="banner-actions">
            <button
              className="banner-cta"
              disabled={loading || !!error}
              onClick={() => (firstGame ? onStart(firstGame) : onUpload())}
            >
              <Play size={15} fill="currentColor" />
              {recent.length
                ? translate("继续上次的冒险")
                : firstGame
                  ? translate("开启今天的第一局")
                  : translate("添加你的第一款游戏")}
              <ArrowRight size={16} />
            </button>
            <button
              className="random-play"
              disabled={loading || !!error || !games.length}
              onClick={() => {
                const game = games[Math.floor(Math.random() * games.length)];
                if (game) onStart(game);
              }}
            >
              <Shuffle size={15} />
              {translate("随机开玩")}
            </button>
          </div>
        </div>
        <div className="banner-art">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <img
            src={controllerImage}
            alt={translate("紫色复古手柄与游戏卡带")}
          />
          <span className="art-note">
            <i /> GOOD TIMES, AGAIN.
          </span>
        </div>
        <div className="banner-label">
          PLAY
          <br />
          <b>YOUR WAY.</b>
        </div>
      </section>
      {loading ? (
        <div className="empty">
          <LoaderCircle className="spin" />
          <p>{translate("正在打开你的游戏角落…")}</p>
        </div>
      ) : error ? (
        <div className="empty" role="alert">
          <p>{error}</p>
        </div>
      ) : (
        <>
          <section className="start-section" aria-labelledby="pinned-title">
            <div className="start-section-heading">
              <div>
                <h2 id="pinned-title">
                  <span className="section-marker" />
                  {translate("快速开始")}
                </h2>
                <p>{translate("把最想玩的放在这里，一点就出发。")}</p>
              </div>
              <span className="slot-count">
                {slots.filter(Boolean).length} / 3
              </span>
            </div>
            <div className="quick-slots">
              {slots.map((id, index) => {
                const game = games.find((item) => item.id === id);
                return (
                  <article
                    className={`quick-slot ${game ? "filled" : "vacant"}`}
                    key={index}
                    aria-label={translate("常玩位置 {{value0}}", {
                      value0: index + 1,
                    })}
                  >
                    {game ? (
                      <>
                        <GameLaunch
                          game={game}
                          index={index}
                          hasSave={hasSave(game.id)}
                          label={translate("开始 {{value0}}", {
                            value0: game.name,
                          })}
                          onStart={onStart}
                        />
                        <button
                          className="slot-edit"
                          aria-label={translate("更换位置 {{value0}} 的游戏", {
                            value0: index + 1,
                          })}
                          onClick={() => choose(index)}
                        >
                          <Pencil size={13} />
                          {translate("更换")}
                        </button>
                      </>
                    ) : (
                      <button
                        className="slot-empty"
                        onClick={() => choose(index)}
                        aria-label={translate("选择位置 {{value0}} 的游戏", {
                          value0: index + 1,
                        })}
                      >
                        <span className="slot-number">0{index + 1}</span>
                        <span className="slot-add">
                          <Plus size={23} />
                        </span>
                        <strong>{translate("留给你的心头好")}</strong>
                        <span>{translate("选择一款游戏")}</span>
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
          <section className="start-section" aria-labelledby="recent-title">
            <div className="start-section-heading">
              <div>
                <h2 id="recent-title">
                  <Clock3 size={17} />
                  {translate("我的常玩")}
                </h2>
                <p>{translate("最近玩过的三款游戏，下次回来接着玩。")}</p>
              </div>
              <button
                className="start-text-link"
                onClick={() => onNavigate("recent")}
              >
                {translate("全部记录")}
                <ArrowRight size={14} />
              </button>
            </div>
            {recent.length ? (
              <div className="recent-games">
                {recent.map((game, index) => (
                  <article
                    className="quick-slot filled recent-game"
                    key={game.id}
                  >
                    <GameLaunch
                      game={game}
                      index={index}
                      hasSave={hasSave(game.id)}
                      label={translate("快速开始 {{value0}}", {
                        value0: game.name,
                      })}
                      onStart={onStart}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className="recent-empty">
                <span className="soft-icon">
                  <Clock3 size={23} />
                </span>
                <div>
                  <strong>{translate("第一场冒险，从现在开始")}</strong>
                  <p>{translate("玩过的游戏会自动留在这里。")}</p>
                </div>
                <button
                  className="start-text-link"
                  onClick={() => onNavigate("library")}
                >
                  {translate("去挑一款")}
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
          </section>
        </>
      )}
      {choosing !== null && (
        <Modal
          title={translate("选择位置 {{value0}} 的游戏", {
            value0: choosing + 1,
          })}
          description={translate("给喜欢的游戏留个位置，随时回来玩。")}
          onClose={() => {
            if (!busy) setChoosing(null);
          }}
        >
          <label className="slot-search">
            <Search size={17} />
            <input
              autoFocus
              aria-label={translate("搜索常玩游戏")}
              placeholder={translate("搜索游戏名称…")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="slot-picker-list">
            {games
              .filter((game) =>
                game.name.toLowerCase().includes(query.trim().toLowerCase()),
              )
              .map((game) => {
                const otherSlot = slots.findIndex(
                  (id, index) => id === game.id && index !== choosing,
                );
                return (
                  <button
                    key={game.id}
                    className="slot-choice"
                    disabled={busy || otherSlot >= 0}
                    onClick={() => void saveSlot(game.id)}
                  >
                    <GameArt game={game} />
                    <span>
                      <strong>{game.name}</strong>
                      <small>
                        {SYSTEMS[game.system].short}
                        {otherSlot >= 0
                          ? translate(" · 已在位置 {{value0}}", {
                              value0: otherSlot + 1,
                            })
                          : ""}
                      </small>
                    </span>
                    {slots[choosing] === game.id ? (
                      <Check size={18} />
                    ) : (
                      <Plus size={17} />
                    )}
                  </button>
                );
              })}
            {!games.some((game) =>
              game.name.toLowerCase().includes(query.trim().toLowerCase()),
            ) && (
              <div className="slot-picker-empty">
                <Gamepad2 size={30} />
                <p>
                  {games.length
                    ? translate("没有找到这个游戏，换个名字试试。")
                    : translate("先往游戏库里放一款喜欢的游戏吧。")}
                </p>
                {!games.length && (
                  <button
                    className="button"
                    onClick={() => {
                      setChoosing(null);
                      onUpload();
                    }}
                  >
                    {translate("从设备添加游戏")}
                  </button>
                )}
              </div>
            )}
          </div>
          {slotError && (
            <p className="error-text" role="alert">
              {slotError}
            </p>
          )}
          <div className="modal-actions">
            {slots[choosing] && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void saveSlot(null)}
              >
                <X size={15} />
                {translate("清空这个位置")}
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setChoosing(null)}
            >
              {translate("取消")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
