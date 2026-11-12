import { useTranslation } from "react-i18next";
import { getLocale } from "./lib/preferences";
import { ClientAccess } from "./components/ClientAccess";
import { Appearance } from "./components/Appearance";
import { translate, tagLabel } from "./lib/i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useRoutes,
  useSearchParams,
} from "react-router";
import {
  ArrowRight,
  Check,
  Clock3,
  FolderHeart,
  Gamepad2,
  Grid2X2,
  Heart,
  HardDrive,
  HelpCircle,
  Keyboard,
  Library,
  List,
  LoaderCircle,
  Menu,
  Pencil,
  Play,
  Plus,
  Save as SaveIcon,
  Search,
  ShieldCheck,
  Sparkles,
  House,
  Tag as TagIcon,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  database,
  deleteGame,
  deleteTag,
  importGames,
  putGame,
  readLibrary,
  initializeLibrary,
  setQuickSlot,
} from "./lib/storage";
import {
  GAME_ACCEPT,
  SYSTEMS,
  formatSize,
  type Game,
  type Save,
  type System,
  type Tag,
} from "./lib/types";
import { Modal } from "./components/Modal";
import { GlobalSearch } from "./components/GlobalSearch";
import { ControlsPage } from "./components/Controls";
import { Saves } from "./components/Saves";
import { GameMenu } from "./components/GameMenu";
import { StoragePage } from "./components/Storage";
import { SortMenu } from "./components/SortMenu";
import Player from "./components/Player";
import { StartPage } from "./components/Start";
import { AboutModal } from "./components/About";
import { AboutPage, PrivacyPage } from "./components/Legal";
import { importRightsNotice, localFilesNotice } from "./lib/site-info";
import { BundledGameCredit } from "./components/BundledGameCredit";
import { beforeAppReload, UpdateBanner } from "./components/UpdateBanner";
import { flushSync } from "react-dom";
import { isDesktop } from "./lib/desktop";
import { applyAppUpdate, getAppUpdate, subscribeAppUpdate } from "./lib/app-updates";
import { DesktopUpdateDialog } from "./components/DesktopUpdateDialog";
import { showDesktopUpdate } from "./lib/desktop-updates";
import { useAutoHideScrollbars } from "./lib/use-auto-hide-scrollbars";

type Page =
  | "start"
  | "library"
  | "recent"
  | "favorites"
  | "saves"
  | "tags"
  | "controls"
  | "storage"
  | "about"
  | "privacy";
const PAGE_TITLES: Record<Page, string> = {
  start: "开始",
  library: "游戏库",
  recent: "最近游玩",
  favorites: "我的收藏",
  saves: "我的存档",
  tags: "标签管理",
  controls: "外设设置",
  storage: "存储管理",
  about: "开源许可",
  privacy: "隐私说明",
};
const pagePath = (page: Page) => (page === "start" ? "/" : `/${page}`);
const COLORS = [
  "#8b6eee",
  "#50af95",
  "#ebaa55",
  "#ee8198",
  "#58a5dd",
  "#7b89a7",
];
const SORT_OPTIONS = [
  {
    value: "added",
    label: "最近添加",
    description: "新加入的游戏排在前面",
    icon: Plus,
  },
  {
    value: "recent",
    label: "最近游玩",
    description: "接着上次的冒险继续玩",
    icon: Clock3,
  },
  {
    value: "name",
    label: "游戏名称",
    description: "按名称顺序，轻松找到",
    icon: List,
  },
];
export default function App() {
  useTranslation();
  useAutoHideScrollbars();
  return useRoutes([
    ...Object.keys(PAGE_TITLES).map((page) => ({
      path: pagePath(page as Page),
      element: <AppPage page={page as Page} />,
    })),
    { path: "/play/:gameId", element: <AppPage page="library" /> },
    { path: "*", element: <Navigate to="/" replace /> },
  ]);
}

function AppPage({ page }: { page: Page }) {
  const appUpdate = useSyncExternalStore(subscribeAppUpdate, getAppUpdate);
  const locale = getLocale();
  const routeNavigate = useNavigate();
  const location = useLocation();
  const { gameId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const mainPanel = useRef<HTMLElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [saves, setSaves] = useState<Save[]>([]);
  const requestedSystem = searchParams.get("system") || "all";
  const system: System | "all" = Object.hasOwn(SYSTEMS, requestedSystem)
    ? (requestedSystem as System)
    : "all";
  const tagFilter = searchParams.get("tag") || "all";
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null]);
  const [searchOpen, setSearchOpen] = useState(false);
  const defaultSort = page === "recent" ? "recent" : "added";
  const requestedSort = searchParams.get("sort");
  const sort = SORT_OPTIONS.some((option) => option.value === requestedSort)
    ? requestedSort!
    : defaultSort;
  const view = searchParams.get("view") === "list" ? "list" : "grid";
  const [upload, setUpload] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [editing, setEditing] = useState<Game | null>(null);
  const [deleting, setDeleting] = useState<Game | null>(null);
  const [saveGame, setSaveGame] = useState<Game | null>(null);
  const [help, setHelp] = useState(false);
  const updateBusy = !!(gameId || upload || editing || deleting || addingTag || saveGame);
  const updateBusyRef = useRef(updateBusy);
  updateBusyRef.current = updateBusy;
  const [mobileMenu, setMobileMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState("");
  const [toast, setToast] = useState("");
  const notify = useCallback((text: string) => setToast(text), []);
  const latestSave = (id: string) =>
    saves
      .filter((s) => s.gameId === id)
      .sort((a, b) => b.created - a.created)[0];
  const playingGame = games.find((game) => game.id === gameId);
  const playing = playingGame
    ? {
        game: playingGame,
        save:
          saves.find(
            (save) =>
              save.gameId === gameId && save.id === searchParams.get("save"),
          ) || latestSave(playingGame.id),
      }
    : null;
  const updateQuery = (key: string, value: string, defaultValue: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === defaultValue) next.delete(key);
      else next.set(key, value);
      return next;
    });
  };
  const setSystem = (value: System | "all") =>
    updateQuery("system", value, "all");
  const setTagFilter = (value: string) => updateQuery("tag", value, "all");
  const setSort = (value: string) => updateQuery("sort", value, defaultSort);
  const setView = (value: string) => updateQuery("view", value, "grid");
  useEffect(() => {
    document.title = page === "start"
      ? translate("拾光 · 桂花载酒，与少年游")
      : translate("{{value0}} · 拾光", {
          value0: playingGame?.name || translate(PAGE_TITLES[page]),
        });
  }, [page, playingGame?.name, locale]);
  useEffect(() => {
    if (gameId && !loading && !fatal && !playingGame) {
      notify(translate("这个游戏不在当前游戏库中，请重新选择。"));
      routeNavigate("/library", { replace: true });
    }
  }, [gameId, loading, fatal, playingGame, notify, routeNavigate]);
  useEffect(() => {
    const onSearchShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      if (playing || (!searchOpen && document.querySelector('[role="dialog"]')))
        return;
      event.preventDefault();
      if (event.repeat) return;
      setSearchOpen((open) => !open);
      setMobileMenu(false);
    };
    window.addEventListener("keydown", onSearchShortcut);
    return () => window.removeEventListener("keydown", onSearchShortcut);
  }, [playing, searchOpen]);
  useEffect(() => {
    setMobileMenu(false);
    setSearchOpen(false);
    setUpload(false);
    setAddingTag(false);
    setEditing(null);
    setDeleting(null);
    setSaveGame(null);
    setHelp(false);
    mainPanel.current?.scrollTo({ top: 0 });
  }, [location.pathname]);
  const refresh = useCallback(async () => {
    const data = await readLibrary();
    setGames(data.games);
    setTags(data.tags);
    setSaves(data.saves);
    setSlots(data.slots);
  }, [locale]);
  useEffect(() => {
    initializeLibrary()
      .then(refresh)
      .catch(() =>
        setFatal(
          translate(
            isDesktop ? "暂时无法打开游戏库，请确认设备有可用空间后重新打开应用。" : "暂时无法打开游戏库，请确认浏览器允许保存网站数据后刷新重试。",
          ),
        ),
      )
      .finally(() => setLoading(false));
  }, [refresh]);
  useLayoutEffect(() => {
    if (loading) return;
    // Hand off only after the initial library state has reached the DOM.
    document.dispatchEvent(
      new Event(fatal ? "shiguang:failed" : "shiguang:ready"),
    );
  }, [loading, fatal]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message || translate("操作未完成，请重试。"));
    }
  };
  const navigate = (next: Page, nextSystem: System | "all" = "all") => {
    const search = nextSystem === "all" ? "" : `?system=${nextSystem}`;
    routeNavigate(pagePath(next) + search);
    setMobileMenu(false);
    mainPanel.current?.scrollTo({ top: 0 });
  };
  const start = async (game: Game, save?: Save) => {
    await putGame({ ...game, lastPlayed: Date.now() });
    await refresh();
    setSaveGame(null);
    const search = save ? `?${new URLSearchParams({ save: save.id })}` : "";
    routeNavigate(`/play/${encodeURIComponent(game.id)}${search}`);
  };
  const filtered = useMemo(
    () =>
      games
        .filter(
          (g) =>
            (system === "all" || g.system === system) &&
            (tagFilter === "all" || g.tags.includes(tagFilter)) &&
            (page !== "favorites" || g.favorite) &&
            (page !== "recent" || g.lastPlayed) &&
            (page !== "saves" || saves.some((s) => s.gameId === g.id)),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, locale)
            : sort === "recent"
              ? (b.lastPlayed || 0) - (a.lastPlayed || 0)
              : b.added - a.added,
        ),
    [games, system, tagFilter, page, sort, saves, locale],
  );
  const favorite = async (game: Game) => {
    await putGame({ ...game, favorite: !game.favorite });
    await refresh();
  };
  const libraryPage = ["library", "recent", "favorites", "saves"].includes(
    page,
  );
  const navigation = (id: Page, Icon: typeof Library, count?: number) => (
    <Link
      className={`nav-item ${page === id ? "active" : ""}`}
      to={pagePath(id)}
      aria-current={page === id ? "page" : undefined}
      onClick={() => setMobileMenu(false)}
    >
      <Icon size={19} />
      <span>{translate(PAGE_TITLES[id])}</span>
      {count !== undefined && <span className="nav-count">{count}</span>}
    </Link>
  );
  return (
    <>
      <div className="app-shell" inert={!!playing || (isDesktop && appUpdate.updating)}>
        <header className="topbar">
          <Link className="brand" to="/" onClick={() => setMobileMenu(false)}>
            <span className="brand-icon">
              <Gamepad2 size={25} />
            </span>
            <span className="brand-copy">
              <strong>{translate("拾光")}</strong>
              <span>SEIZE THE DAY</span>
            </span>
          </Link>
          <button
            className="icon-button mobile-toggle"
            aria-label={translate("展开导航")}
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu />
          </button>
          <p className="top-motto">{translate("桂花载酒，与少年游。")}</p>
          <div className="top-actions">
            <button
              ref={searchTrigger}
              className="search-trigger"
              aria-label={translate("搜索")}
              aria-haspopup="dialog"
              aria-expanded={searchOpen}
              aria-keyshortcuts="Control+k Meta+k"
              title={translate("搜索游戏（Ctrl+K / ⌘K）")}
              onClick={() => {
                setSearchOpen(true);
                setMobileMenu(false);
              }}
            >
              <Search size={18} />
              <span>{translate("搜索")}</span>
              <kbd>Ctrl K</kbd>
            </button>
            <Appearance />
            <ClientAccess onNotice={notify} />
            <button
              className="icon-button about-trigger"
              aria-label={translate("关于拾光")}
              title={translate("关于拾光")}
              onClick={() => setHelp(true)}
            >
              <HelpCircle size={21} />
            </button>
          </div>
        </header>
        {mobileMenu && (
          <button
            className="sidebar-backdrop"
            aria-label={translate("收起导航")}
            onClick={() => setMobileMenu(false)}
          />
        )}
        <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
          <button
            className="upload-nav"
            onClick={() => {
              setUpload(true);
              setMobileMenu(false);
            }}
          >
            <Plus size={19} />
            <span>{translate("从设备添加游戏")}</span>
            <span className="plus-dot" aria-hidden="true">
              +
            </span>
          </button>
          <div className="nav-group">
            <span className="nav-label">{translate("我的空间")}</span>
            {navigation("start", House)}
            {navigation("library", Library, games.length)}
            {navigation("recent", Clock3)}
            {navigation(
              "favorites",
              Heart,
              games.filter((g) => g.favorite).length,
            )}
            {navigation("saves", SaveIcon)}
          </div>
          <div className="nav-group settings-nav">
            <span className="nav-label">{translate("整理与设置")}</span>
            {navigation("tags", TagIcon)}
            {navigation("controls", Keyboard)}
            {navigation("storage", HardDrive)}
          </div>
          <div className="sidebar-bottom">
            <div className="sidebar-tip">
              <span className="tiny-spark">
                <Sparkles size={16} />
              </span>
              <strong>{translate("来自时光的礼物")}</strong>
              <p>
                {translate("万物晴朗，未来可期，")}
                <br />
                {translate("一起来宴请年少时候的自己吧。")}
              </p>
              <nav
                className="sidebar-legal-links"
                aria-label={translate("网站说明")}
              >
                <Link
                  to="/about"
                  aria-current={page === "about" ? "page" : undefined}
                >
                  {translate("开源许可")}
                </Link>
                <Link
                  to="/privacy"
                  aria-current={page === "privacy" ? "page" : undefined}
                >
                  {translate("隐私说明")}
                </Link>
              </nav>
            </div>
          </div>
        </aside>
        {/* Keep updates pending until the player closes; this shell is inert while playing. */}
        {!gameId && <UpdateBanner busy={updateBusy} />}
        <main className="main-panel" ref={mainPanel}>
          <div className="content-wrap">
            {page === "start" && (
              <StartPage
                games={games}
                saves={saves}
                slots={slots}
                loading={loading}
                error={fatal}
                onStart={(game) =>
                  void run(() => start(game, latestSave(game.id)))
                }
                onSlot={async (index, id) => {
                  await setQuickSlot(index, id);
                  await refresh();
                }}
                onNavigate={navigate}
                onUpload={() => setUpload(true)}
              />
            )}
            {libraryPage && (
              <>
                <div className="page-heading">
                  <div className="heading-row">
                    <div>
                      <h1>
                        {translate(PAGE_TITLES[page])}
                        <span className="count-pill">{filtered.length}</span>
                      </h1>
                      <p>
                        {page === "recent"
                          ? translate("上次的冒险，还在等你。")
                          : page === "favorites"
                            ? translate("把喜欢的游戏，放在离自己更近的地方。")
                            : page === "saves"
                              ? translate("保存每一个精彩瞬间，下次接着玩。")
                              : translate("今天该玩什么呢？")}
                      </p>
                    </div>
                    <button className="button" onClick={() => setUpload(true)}>
                      <Plus size={17} />
                      {translate("从设备添加游戏")}
                    </button>
                  </div>
                </div>
                <div className="library-controls">
                  <div
                    className="filter-row platform-filter"
                    role="group"
                    aria-label={translate("游戏平台")}
                  >
                    <span className="filter-label">
                      <Gamepad2 size={15} />
                      {translate("平台")}
                    </span>
                    <button
                      className={`filter-chip ${system === "all" ? "selected" : ""}`}
                      aria-pressed={system === "all"}
                      onClick={() => setSystem("all")}
                    >
                      {translate("所有平台")}
                    </button>
                    {Object.entries(SYSTEMS).map(([id, platform]) => (
                      <button
                        key={id}
                        className={`filter-chip ${system === id ? "selected" : ""}`}
                        aria-pressed={system === id}
                        onClick={() => setSystem(id as System)}
                      >
                        {platform.short}
                      </button>
                    ))}
                  </div>
                  <div
                    className="filter-row"
                    role="group"
                    aria-label={translate("游戏标签")}
                  >
                    <span className="filter-label">
                      <TagIcon size={15} />
                      {translate("标签")}
                    </span>
                    <button
                      className={`filter-chip ${tagFilter === "all" ? "selected" : ""}`}
                      aria-pressed={tagFilter === "all"}
                      onClick={() => setTagFilter("all")}
                    >
                      {translate("全部游戏")}
                    </button>
                    {tags.map((t) => (
                      <button
                        className={`filter-chip ${tagFilter === t.id ? "selected" : ""}`}
                        key={t.id}
                        aria-pressed={tagFilter === t.id}
                        onClick={() => setTagFilter(t.id)}
                      >
                        <i style={{ background: t.color }} />
                        {tagLabel(t)}
                      </button>
                    ))}
                    <button
                      className="filter-manage"
                      aria-label={translate("添加标签")}
                      onClick={() => setAddingTag(true)}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  <div className="library-toolbar">
                    <div className="library-caption">
                      <span className="section-marker" />
                      {page === "saves"
                        ? translate("保存的冒险")
                        : translate("游戏收藏夹")}
                      <small>
                        {filtered.length}
                        {translate("个游戏")}
                      </small>
                    </div>
                    <div className="toolbar-actions">
                      <SortMenu
                        label={translate("排序方式")}
                        title={translate("排列游戏")}
                        value={sort}
                        onValueChange={setSort}
                        options={SORT_OPTIONS}
                      />
                      <div className="view-switch">
                        <button
                          className={view === "grid" ? "selected" : ""}
                          aria-label={translate("网格视图")}
                          onClick={() => setView("grid")}
                        >
                          <Grid2X2 size={16} />
                        </button>
                        <button
                          className={view === "list" ? "selected" : ""}
                          aria-label={translate("列表视图")}
                          onClick={() => setView("list")}
                        >
                          <List size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {loading ? (
                  <div className="empty">
                    <LoaderCircle className="spin" />
                    <p>{translate("正在打开你的游戏库…")}</p>
                  </div>
                ) : fatal ? (
                  <div className="empty">
                    <p>{fatal}</p>
                  </div>
                ) : (
                  <div
                    className={`games-grid ${view === "list" ? "list-view" : ""}`}
                  >
                    {filtered.map((game) => (
                      <article
                        className={`game-card game-${game.system}`}
                        key={game.id}
                      >
                        <button
                          className="game-cover"
                          aria-label={translate("开始 {{value0}}", {
                            value0: game.name,
                          })}
                          onClick={() =>
                            void run(() =>
                              page === "saves"
                                ? Promise.resolve(setSaveGame(game))
                                : start(game, latestSave(game.id)),
                            )
                          }
                        >
                          <div className="cover-decoration">
                            <span>{SYSTEMS[game.system].short}</span>
                            <Gamepad2 size={68} />
                          </div>
                          {game.cover && (
                            <img
                              src={game.cover}
                              alt={translate("{{value0}} 游戏封面", {
                                value0: game.name,
                              })}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          )}
                          <span className={`cover-console ${game.system}`}>
                            {SYSTEMS[game.system].short}
                          </span>
                          <span className="cover-play">
                            <Play size={25} fill="currentColor" />
                          </span>
                          <span className="cover-bottom">
                            <span>
                              {game.system === "nes"
                                ? "8-BIT CLASSICS"
                                : game.system === "gb"
                                  ? "POCKET MEMORIES"
                                  : "LET’S PLAY"}
                            </span>
                            <span>01 / P1</span>
                          </span>
                        </button>
                        <button
                          className={`favorite-button ${game.favorite ? "is-favorite" : ""}`}
                          aria-label={`${game.favorite ? translate("取消收藏") : translate("收藏")} ${game.name}`}
                          onClick={() => void run(() => favorite(game))}
                        >
                          <Heart
                            size={17}
                            fill={game.favorite ? "currentColor" : "none"}
                          />
                        </button>
                        <div className="game-info">
                          <div className="game-title-row">
                            <h3>{game.name}</h3>
                            <GameMenu
                              game={game}
                              saveCount={
                                saves.filter((s) => s.gameId === game.id).length
                              }
                              onEdit={() => setEditing(game)}
                              onManageSaves={() => setSaveGame(game)}
                              onDelete={() => setDeleting(game)}
                              notify={notify}
                            />
                          </div>
                          <div className="game-meta">
                            <span
                              className="game-size"
                              aria-label={translate("游戏大小 {{value0}}", {
                                value0: formatSize(game.size),
                              })}
                            >
                              <HardDrive size={12} />
                              {formatSize(game.size)}
                            </span>
                            <i />{" "}
                            <span>
                              {game.lastPlayed
                                ? translate("最近玩过")
                                : translate("等待你的第一场冒险")}
                            </span>
                          </div>
                          <div className="game-tag-row">
                            {game.tags.map((id) => {
                              const t = tags.find((t) => t.id === id);
                              return t ? (
                                <span
                                  className="tag-pill"
                                  key={id}
                                  style={{
                                    color: t.color,
                                    background: `${t.color}13`,
                                  }}
                                >
                                  {tagLabel(t)}
                                </span>
                              ) : null;
                            })}
                          </div>
                          <BundledGameCredit game={game} />
                          <div className="game-card-footer">
                            <span>
                              <Clock3 size={13} />
                              {game.playSeconds
                                ? translate("{{value0}} 分钟", {
                                    value0: Math.max(
                                      1,
                                      Math.round(game.playSeconds / 60),
                                    ),
                                  })
                                : translate("还未游玩")}
                            </span>
                            <button
                              onClick={() =>
                                void run(() =>
                                  page === "saves"
                                    ? Promise.resolve(setSaveGame(game))
                                    : start(game, latestSave(game.id)),
                                )
                              }
                            >
                              {page === "saves"
                                ? translate("查看存档")
                                : latestSave(game.id)
                                  ? translate("继续游戏")
                                  : translate("开始游戏")}
                              <Play size={13} fill="currentColor" />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                    {page === "library" &&
                      system === "all" &&
                      tagFilter === "all" && (
                        <button
                          className="add-game-card"
                          onClick={() => setUpload(true)}
                        >
                          <span className="add-game-icon">
                            <Plus size={26} />
                          </span>
                          <strong>{translate("下一份快乐，由你添加")}</strong>
                          <span>{translate("把喜欢的游戏放进来")}</span>
                          <div>
                            {Object.values(SYSTEMS).map((system) => (
                              <span key={system.short}>{system.short}</span>
                            ))}
                          </div>
                        </button>
                      )}
                  </div>
                )}
                {!loading &&
                  !fatal &&
                  filtered.length === 0 &&
                  (page !== "library" ||
                    tagFilter !== "all" ||
                    system !== "all") && (
                    <div className="empty">
                      <FolderHeart size={44} />
                      <h3>
                        {page === "favorites"
                          ? translate("喜欢的游戏，值得一颗心")
                          : page === "recent"
                            ? translate("冒险，从第一局开始")
                            : page === "saves"
                              ? translate("还没有留下冒险足迹")
                              : translate("这里还没有游戏")}
                      </h3>
                      <p>
                        {translate("挑一款游戏开始吧，快乐会慢慢填满这里。")}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => navigate("library")}
                      >
                        {translate("回到游戏库")}
                      </button>
                    </div>
                  )}
              </>
            )}
            {page === "storage" && (
              <StoragePage
                games={games}
                saves={saves}
                refresh={refresh}
                notify={notify}
              />
            )}
            {page === "about" && <AboutPage />}
            {page === "privacy" && (
              <PrivacyPage onStorage={() => navigate("storage")} />
            )}
            {page === "controls" && (
              <>
                <PageHeading
                  title={translate("外设设置")}
                  subtitle={translate("找到顺手的玩法，每一局都更自在。")}
                />
                <ControlsPage />
              </>
            )}
            {page === "tags" && (
              <>
                <PageHeading
                  title={translate("标签管理")}
                  subtitle={translate(
                    "为你的游戏分个类，想玩的时候一眼就找到。",
                  )}
                />
                <TagManager
                  tags={tags}
                  games={games}
                  refresh={refresh}
                  notify={notify}
                />
              </>
            )}
          </div>
        </main>
      </div>
      {searchOpen && (
        <GlobalSearch
          games={games}
          tags={tags}
          saves={saves}
          loading={loading}
          error={fatal}
          triggerRef={searchTrigger}
          onClose={() => setSearchOpen(false)}
          onStart={(game) => {
            setSearchOpen(false);
            void run(() => start(game, latestSave(game.id)));
          }}
        />
      )}
      {upload && (
        <UploadModal
          onClose={() => setUpload(false)}
          onDone={() => {
            setUpload(false);
            navigate("library");
          }}
          onRefresh={refresh}
        />
      )}
      {addingTag && (
        <TagEditorModal
          tags={tags}
          onClose={() => setAddingTag(false)}
          refresh={refresh}
          notify={notify}
        />
      )}
      {editing && (
        <EditModal
          game={editing}
          tags={tags}
          onClose={() => setEditing(null)}
          onSave={async (g) => {
            await putGame(g);
            await refresh();
            setEditing(null);
            notify(translate("游戏信息已保存"));
          }}
        />
      )}
      {deleting && (
        <Modal
          title={translate("删除「{{value0}}」？", { value0: deleting.name })}
          description={translate(
            isDesktop ? "游戏和它的所有存档都会从这台设备移除，删除后无法恢复。" : "游戏和它的所有存档都会从此浏览器移除，删除后无法恢复。",
          )}
          onClose={() => setDeleting(null)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setDeleting(null)}
            >
              {translate("再想想")}
            </button>
            <button
              className="button danger"
              onClick={() =>
                void run(async () => {
                  await deleteGame(deleting.id);
                  if (deleting.id === gameId)
                    routeNavigate("/library", { replace: true });
                  setDeleting(null);
                  await refresh();
                  notify(translate("游戏已移除"));
                })
              }
            >
              {translate("删除游戏与存档")}
            </button>
          </div>
        </Modal>
      )}
      {saveGame && (
        <Modal
          title={translate("{{value0}} · 存档", { value0: saveGame.name })}
          description={translate("从熟悉的地方，继续你的冒险。")}
          onClose={() => setSaveGame(null)}
          wide
        >
          <Saves
            game={saveGame}
            saves={saves.filter((s) => s.gameId === saveGame.id)}
            onRefresh={refresh}
            notify={notify}
            onLoad={(save) => void run(() => start(saveGame, save))}
          />
        </Modal>
      )}
      {isDesktop && <DesktopUpdateDialog />}
      {help && <AboutModal
        onClose={() => setHelp(false)}
        updateBusy={updateBusy}
        onUpdate={() => {
          // Remove this dialog before the shared update guard checks for unfinished work.
          flushSync(() => setHelp(false));
          showDesktopUpdate();
          void applyAppUpdate(() => beforeAppReload(updateBusyRef.current));
        }}
      />}
      {playing && (
        <Player
          key={playing.game.id}
          game={playing.game}
          initialSave={playing.save}
          saves={saves.filter((s) => s.gameId === playing.game.id)}
          onEdit={() => setEditing(playing.game)}
          onDelete={() => setDeleting(playing.game)}
          dialogOpen={!!editing || !!deleting}
          onRefresh={refresh}
          onClose={() => {
            routeNavigate("/library", { replace: true });
          }}
          notify={notify}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            aria-label={translate("关闭提示")}
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-heading">
      <div className="heading-row">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
function UploadModal({
  onClose,
  onDone,
  onRefresh,
}: {
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onDone: () => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean }[]>([]);
  const upload = async (files: FileList | File[]) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await importGames(Array.from(files));
      setResults((prev) => [...prev, ...next]);
      await onRefresh();
    } catch {
      setResults((prev) => [
        ...prev,
        {
          name: translate("暂时无法更新游戏库，请刷新页面后重试。"),
          ok: false,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={translate("从设备添加游戏")}
      description={translate("选择设备上的游戏文件，放进你的专属游戏库。")}
      className="upload-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <input
        ref={picker}
        aria-label={translate("选择游戏文件")}
        hidden
        type="file"
        multiple
        accept={GAME_ACCEPT}
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="upload-layout">
        <div className="upload-files">
          <button
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            disabled={busy}
            onClick={() => picker.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void upload(e.dataTransfer.files);
            }}
          >
            {busy ? (
              <LoaderCircle className="spin" size={34} />
            ) : (
              <Upload size={34} />
            )}
            <strong>
              {busy
                ? translate("正在整理你的游戏…")
                : translate("点击选择，或把游戏拖到这里")}
            </strong>
            <span>{translate(isDesktop ? "可以一次添加多个游戏，文件保存在这台设备" : "可以一次添加多个游戏，每个不超过 1 GB")}</span>
            <span className="upload-auto">
              <Check size={14} />
              {translate("自动识别游戏平台")}
            </span>
          </button>
          {results.length > 0 && (
            <div className="upload-results" role="status">
              {results.map((r, i) => (
                <div className={r.ok ? "success" : "error"} key={i}>
                  {r.ok ? <Check size={16} /> : <HelpCircle size={16} />}
                  <span>{r.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <aside className="upload-guide" aria-label={translate("添加游戏说明")}>
          <h3>{translate("这些游戏都能玩")}</h3>
          <div className="upload-platforms">
            {Object.values(SYSTEMS).map((platform) => (
              <span key={platform.short}>{platform.short}</span>
            ))}
          </div>
          <h3>{translate("添加前的小提示")}</h3>
          <ul>
            <li>
              {translate(
                "街机游戏直接选择完整的 ZIP 游戏包，保留原文件名；其他压缩包请先解压。",
              )}
            </li>
            <li>
              {translate(
                "PSP 支持 ISO、CSO、PBP；PSX 光盘的 .cue 和 .bin 文件请一起选择。",
              )}
            </li>
            <li>{translate("需要启动文件时，可以到「存储管理」添加。")}</li>
          </ul>
          <p className="import-rights-note">
            {translate(importRightsNotice || "")}
          </p>
        </aside>
      </div>
      <div className="upload-footer">
        <p className="subtle-note">
          <ShieldCheck size={14} />
          {translate(localFilesNotice || "")}
        </p>
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              results.some((result) => result.ok) ? onDone() : onClose()
            }
          >
            {results.some((r) => r.ok)
              ? translate("去游戏库看看")
              : translate("完成")}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
function EditModal({
  game,
  tags,
  onClose,
  onSave,
}: {
  game: Game;
  tags: Tag[];
  onClose: () => void;
  onSave: (game: Game) => Promise<void>;
}) {
  const [draft, setDraft] = useState(game);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={translate("编辑游戏")}
      description={translate("修改游戏名称、标签或封面。")}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.name.trim()) return;
          setBusy(true);
          try {
            await onSave({ ...draft, name: draft.name.trim() });
          } catch {
            setError(translate("保存失败，请重试。"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          {translate("游戏名称")}
          <input
            autoFocus
            required
            maxLength={80}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="field">
          {translate("游戏平台")}
          <input
            readOnly
            value={`${SYSTEMS[draft.system].short} · ${translate(SYSTEMS[draft.system].name)}`}
          />
        </label>
        <label className="field">{translate("游戏标签")}</label>
        <div className="edit-tags">
          {tags.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`filter-chip ${draft.tags.includes(t.id) ? "selected" : ""}`}
              onClick={() =>
                setDraft({
                  ...draft,
                  tags: draft.tags.includes(t.id)
                    ? draft.tags.filter((id) => id !== t.id)
                    : [...draft.tags, t.id],
                })
              }
            >
              <i style={{ background: t.color }} />
              {tagLabel(t)}
              {draft.tags.includes(t.id) && <Check size={13} />}
            </button>
          ))}
        </div>
        <label className="field cover-field">
          {translate("游戏封面")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (
                !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
                f.size > 3 * 1024 * 1024
              ) {
                setError(
                  translate("请选择小于 3 MB 的 PNG、JPG 或 WebP 图片。"),
                );
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                setDraft({ ...draft, cover: String(reader.result) });
                setError("");
              };
              reader.readAsDataURL(f);
            }}
          />
        </label>
        <p className="subtle-note">
          {game.filename} · {formatSize(game.size)}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {translate("取消")}
          </button>
          <button className="button" disabled={busy || !draft.name.trim()}>
            {busy ? translate("正在保存…") : translate("保存修改")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TagManager({
  tags,
  games,
  refresh,
  notify,
}: {
  tags: Tag[];
  games: Game[];
  refresh: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [editing, setEditing] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [open, setOpen] = useState(false);
  const edit = (tag?: Tag) => {
    setEditing(tag || null);
    setOpen(true);
  };
  return (
    <>
      <div className="tag-page-toolbar">
        <span>
          {tags.length}
          {translate("个标签 · 按喜好整理游戏")}
        </span>
        <button className="button" onClick={() => edit()}>
          <Plus size={16} />
          {translate("新建标签")}
        </button>
      </div>
      <div className="tag-grid">
        {tags.map((t) => (
          <article className="tag-card" key={t.id}>
            <div className="tag-card-top">
              <span style={{ color: t.color, background: `${t.color}15` }}>
                <TagIcon size={22} />
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label={translate("编辑标签 {{value0}}", {
                    value0: tagLabel(t),
                  })}
                  onClick={() => edit(t)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={translate("删除标签 {{value0}}", {
                    value0: tagLabel(t),
                  })}
                  onClick={() => setDeleting(t)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <h3>{tagLabel(t)}</h3>
            <p>
              {games.filter((g) => g.tags.includes(t.id)).length}
              {translate("个游戏")}
            </p>
            <div className="tag-game-names">
              {games
                .filter((g) => g.tags.includes(t.id))
                .map((g) => g.name)
                .join(" · ") || translate("还没有游戏使用这个标签")}
            </div>
          </article>
        ))}
        <button className="tag-add" onClick={() => edit()}>
          <Plus size={24} />
          <span>{translate("新建标签")}</span>
        </button>
      </div>
      {open && (
        <TagEditorModal
          tags={tags}
          tag={editing}
          onClose={() => setOpen(false)}
          refresh={refresh}
          notify={notify}
        />
      )}
      {deleting && (
        <Modal
          title={translate("删除「{{value0}}」标签？", {
            value0: tagLabel(deleting),
          })}
          description={translate("游戏会保留，只会移除这个标签。")}
          onClose={() => setDeleting(null)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setDeleting(null)}
            >
              {translate("取消")}
            </button>
            <button
              className="button danger"
              onClick={async () => {
                try {
                  await deleteTag(deleting.id);
                  await refresh();
                  setDeleting(null);
                } catch {
                  notify(translate("删除失败，请重试。"));
                }
              }}
            >
              {translate("删除标签")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function TagEditorModal({
  tags,
  tag,
  onClose,
  refresh,
  notify,
}: {
  tags: Tag[];
  tag?: Tag | null;
  onClose: () => void;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [name, setName] = useState(tag ? tagLabel(tag) : "");
  const [color, setColor] = useState(tag?.color || COLORS[0]);
  const [error, setError] = useState("");
  return (
    <Modal
      title={tag ? translate("编辑标签") : translate("添加标签")}
      description={translate("比如「想玩很久了」或者「周末必玩」。")}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const savedName =
            tag && name.trim() === tagLabel(tag) ? tag.name : name.trim();
          if (
            tags.some(
              (t) =>
                t.id !== tag?.id &&
                (t.name === savedName || tagLabel(t) === name.trim()),
            )
          ) {
            setError(translate("已经有这个标签了，换个名字吧。"));
            return;
          }
          try {
            await (
              await database
            ).put("tags", {
              id: tag?.id || crypto.randomUUID(),
              name: savedName,
              color,
            });
            await refresh();
            onClose();
            notify(translate("标签已保存"));
          } catch {
            setError(translate("保存失败，请重试。"));
          }
        }}
      >
        <label className="field">
          {translate("标签名称")}
          <input
            autoFocus
            required
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">{translate("选个颜色")}</label>
        <div className="color-picker">
          {COLORS.map((c) => (
            <button
              type="button"
              aria-label={translate("颜色 {{value0}}", { value0: c })}
              aria-pressed={color === c}
              key={c}
              style={{ background: c }}
              onClick={() => setColor(c)}
            >
              {color === c && <Check size={18} />}
            </button>
          ))}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {translate("取消")}
          </button>
          <button className="button" disabled={!name.trim()}>
            {translate("保存标签")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
