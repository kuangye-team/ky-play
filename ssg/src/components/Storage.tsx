import { isDesktop } from "../lib/runtime";
import { database } from "../lib/storage/index";
import { getLocale } from "../lib/preferences";
import { translate } from "../lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock3,
  Download,
  Gamepad2,
  HardDrive,
  List,
  LoaderCircle,
  RefreshCw,
  Save as SaveIcon,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  cleanupBytes,
  cleanupItems,
  cleanStorage,
  putBios,
  readStorage,
  type Cleanup,
  type StorageItem,
  type StorageSnapshot,
} from "../lib/storage-management";
import { download, exportSave } from "../lib/storage";
import { importRightsNotice } from "../lib/site-info";
import {
  formatDate,
  formatSize,
  SYSTEMS,
  type Game,
  type Save,
} from "../lib/types";
import { Modal } from "./Modal";
import { SortMenu } from "./SortMenu";
import { StorageDirectory } from "./StorageDirectory";

const SORT_OPTIONS = [
  {
    value: "size",
    label: "占用从大到小",
    description: "先看看最占空间的文件",
    icon: HardDrive,
  },
  {
    value: "name",
    label: "按名称排序",
    description: "按名字查找游戏和存档",
    icon: List,
  },
  {
    value: "date",
    label: "最近添加",
    description: "新加入的文件排在前面",
    icon: Clock3,
  },
];

const itemKey = (item: StorageItem) => `${item.kind}:${item.id}`;
export function StoragePage({
  games,
  saves,
  refresh,
  notify,
}: {
  games: Game[];
  saves: Save[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const locale = getLocale();
  const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [biosOpen, setBiosOpen] = useState(false);
  const [biosDragging, setBiosDragging] = useState(false);
  const [biosError, setBiosError] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("size");
  const [selected, setSelected] = useState(new Set<string>());
  const [pending, setPending] = useState<{
    title: string;
    description: string;
    cleanup: Cleanup;
  } | null>(null);
  const biosInput = useRef<HTMLInputElement>(null);
  const biosTrigger = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    const next = await readStorage();
    setSnapshot(next);
    setSelected(
      (current) =>
        new Set(
          [...current].filter((key) =>
            next.items.some((item) => itemKey(item) === key),
          ),
        ),
    );
    setError("");
    try {
      setEstimate((await (await database).estimate()) || null);
    } catch {
      setEstimate(null);
    }
  }, []);
  useEffect(() => {
    void load().catch(() =>
      setError(translate("暂时无法读取占用情况，请重试。")),
    );
  }, [load, games, saves]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify((e as Error).message || translate("操作没有完成，请重试。"));
    } finally {
      setBusy(false);
    }
  };
  const addBios = (files: FileList | null) => {
    if (busy || !files?.length) return;
    setBiosError("");
    if (files.length !== 1) {
      setBiosError(translate("一次只需添加一个启动文件。"));
      return;
    }
    const file = files[0];
    void run(async () => {
      try {
        await putBios(file);
        await load();
        notify(translate("PSX 启动文件已保存"));
      } catch (error) {
        setBiosError(
          (error as Error).message || translate("操作没有完成，请重试。"),
        );
      }
    });
  };
  const visible = useMemo(
    () =>
      (snapshot?.items || [])
        .filter(
          (item) =>
            (filter === "all" ||
              filter === item.kind ||
              (filter === "large" && item.size >= 32 * 1024 ** 2)) &&
            `${item.name} ${item.game?.name || ""}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, locale)
            : sort === "date"
              ? (b.save?.created || b.game?.added || 0) -
                (a.save?.created || a.game?.added || 0)
              : b.size - a.size,
        ),
    [snapshot, filter, query, sort, locale],
  );
  const chosen = (snapshot?.items || []).filter((item) =>
    selected.has(itemKey(item)),
  );
  const selection: Cleanup = {
    gameIds: chosen
      .filter((item) => item.kind === "game")
      .map((item) => item.id),
    saveIds: chosen
      .filter((item) => item.kind === "save")
      .map((item) => item.id),
  };
  const chooseDelete = (cleanup: Cleanup) =>
    setPending({
      title: translate("清理这些文件？"),
      description: cleanup.gameIds?.length
        ? translate(
            "选中的游戏及其所有存档都会删除，无法恢复。请先导出需要保留的进度。",
          )
        : translate(
            "选中的存档会永久删除，游戏文件会保留。请先导出需要保留的进度。",
          ),
      cleanup,
    });
  const changeFilter = (value: string) => {
    setFilter(value);
    setSelected(new Set());
  };
  const total = snapshot?.totalBytes || 0;
  const gameCount =
    snapshot?.items.filter((item) => item.kind === "game").length || 0;
  const saveCount =
    snapshot?.items.filter((item) => item.kind === "save").length || 0;
  const available =
    estimate?.quota === undefined || estimate.usage === undefined
      ? null
      : Math.max(0, estimate.quota - estimate.usage);
  return (
    <div className="storage-page">
      <div className="heading-row">
        <div>
          <h1>{translate("存储管理")}</h1>
          <p>{translate("重要的进度，记得先导出一份。文件清理后无法恢复。")}</p>
        </div>
        <div className="storage-heading-actions">
          <button
            ref={biosTrigger}
            className="button secondary"
            disabled={busy || !snapshot}
            aria-haspopup="dialog"
            aria-expanded={biosOpen}
            onClick={() => {
              setBiosError("");
              setBiosDragging(false);
              setBiosOpen(true);
            }}
          >
            <Gamepad2 size={16} />
            {translate("PSX 启动文件")}
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run(load)}
          >
            <RefreshCw size={16} />
            {translate("刷新用量")}
          </button>
        </div>
      </div>
      {isDesktop && <StorageDirectory busy={busy} setBusy={setBusy} refresh={load} notify={notify} />}
      {error ? (
        <div className="empty" role="alert">
          <HardDrive />
          <p>{error}</p>
          <button className="button secondary" onClick={() => void run(load)}>
            {translate("重新读取")}
          </button>
        </div>
      ) : !snapshot ? (
        <div className="empty">
          <LoaderCircle className="spin" />
          <p>{translate("正在查看空间占用…")}</p>
        </div>
      ) : (
        <>
          <section
            className="storage-overview"
            aria-label={translate("存储用量")}
          >
            <div className="storage-overview-heading">
              <div>
                <span className="storage-eyebrow">
                  <HardDrive size={16} />
                  {translate("已用空间")}
                </span>
                <strong className="storage-total">{formatSize(total)}</strong>
                <p>
                  {translate("已保存")}
                  {gameCount}
                  {translate("个游戏 ·")}
                  {saveCount}
                  {translate("个存档")}
                </p>
              </div>
              <div className="storage-available">
                <ShieldCheck size={24} />
                <strong>{translate(isDesktop ? "文件保存在这台设备" : "文件保存在此浏览器")}</strong>
                <span>
                  {available === null
                    ? translate(isDesktop ? "文件只保存在这台设备" : "文件只保存在当前浏览器")
                    : translate(isDesktop ? "设备可用空间约 {{value0}}" : "浏览器可用空间约 {{value0}}", {
                        value0: formatSize(available),
                      })}
                </span>
              </div>
            </div>
            <div
              className="storage-bar"
              aria-label={translate("已保存文件 {{value0}}", {
                value0: formatSize(total),
              })}
            >
              <span
                className="segment-games"
                style={{
                  width: `${total ? (snapshot.gameBytes / total) * 100 : 0}%`,
                }}
              />
              <span
                className="segment-saves"
                style={{
                  width: `${total ? (snapshot.saveBytes / total) * 100 : 0}%`,
                }}
              />
              <span
                className="segment-other"
                style={{
                  width: `${total ? (snapshot.otherBytes / total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="storage-stats">
              <button onClick={() => changeFilter("game")}>
                <i className="segment-games" />
                <span>
                  {translate("游戏文件")}
                  <strong>{formatSize(snapshot.gameBytes)}</strong>
                </span>
                <small>
                  {gameCount}
                  {translate("个游戏")}
                </small>
              </button>
              <button onClick={() => changeFilter("save")}>
                <i className="segment-saves" />
                <span>
                  {translate("存档与画面")}
                  <strong>{formatSize(snapshot.saveBytes)}</strong>
                </span>
                <small>
                  {saveCount}
                  {translate("个存档")}
                </small>
              </button>
              <div>
                <i className="segment-other" />
                <span>
                  {translate("封面与启动文件")}
                  <strong>{formatSize(snapshot.otherBytes)}</strong>
                </span>
                <small>{translate("其他文件")}</small>
              </div>
            </div>
            <p className="storage-note">
              {translate(
                isDesktop ? "按已保存的游戏、存档和封面统计。设备可用空间与其他应用共用。" : "按已保存的游戏、存档和封面统计。浏览器总用量还可能包含浏览器保存的网页内容。",
              )}
            </p>
          </section>
          <section className="storage-files" aria-label={translate("文件清理")}>
            <div className="storage-file-toolbar">
              <div className="storage-tabs">
                {[
                  ["all", translate("全部文件")],
                  ["game", translate("游戏")],
                  ["save", translate("存档")],
                  ["large", translate("大文件")],
                ].map(([id, title]) => (
                  <button
                    key={id}
                    aria-pressed={filter === id}
                    className={filter === id ? "active" : ""}
                    onClick={() => changeFilter(id)}
                  >
                    {title}
                  </button>
                ))}
              </div>
              <div className="storage-file-filters">
                <SortMenu
                  label={translate("文件排序")}
                  title={translate("排列文件")}
                  value={sort}
                  onValueChange={setSort}
                  options={SORT_OPTIONS}
                />
                <label className="storage-search">
                  <Search size={15} />
                  <input
                    aria-label={translate("搜索存储文件")}
                    placeholder={translate("搜索游戏或存档")}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelected(new Set());
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="storage-selection">
              <label>
                <input
                  type="checkbox"
                  aria-label={translate("选择当前列表全部文件")}
                  disabled={!visible.length || busy}
                  checked={
                    visible.length > 0 &&
                    visible.every((item) => selected.has(itemKey(item)))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(visible.map(itemKey))
                        : new Set(),
                    )
                  }
                />
                {chosen.length
                  ? translate("已选 {{value0}} 项 · 可清理 {{value1}}", {
                      value0: chosen.length,
                      value1: formatSize(cleanupBytes(snapshot, selection)),
                    })
                  : translate("选择要清理的文件")}
              </label>
              <button
                className="small-button storage-delete"
                disabled={!chosen.length || busy}
                onClick={() => chooseDelete(selection)}
              >
                <Trash2 size={14} />
                {translate("清理所选")}
              </button>
            </div>
            {visible.length ? (
              <div className="storage-table-wrap">
                <table className="storage-table">
                  <thead>
                    <tr>
                      <th scope="col">{translate("文件名称")}</th>
                      <th scope="col">{translate("类型")}</th>
                      <th scope="col">{translate("占用空间")}</th>
                      <th scope="col">{translate("添加时间")}</th>
                      <th scope="col">{translate("操作")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr
                        key={itemKey(item)}
                        className={
                          selected.has(itemKey(item)) ? "selected" : ""
                        }
                      >
                        <td>
                          <div className="storage-file-name">
                            <input
                              type="checkbox"
                              aria-label={translate("选择 {{value0}}", {
                                value0: item.name,
                              })}
                              disabled={busy}
                              checked={selected.has(itemKey(item))}
                              onChange={() =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (next.has(itemKey(item)))
                                    next.delete(itemKey(item));
                                  else next.add(itemKey(item));
                                  return next;
                                })
                              }
                            />
                            <span className={`storage-file-icon ${item.kind}`}>
                              {item.kind === "game" ? (
                                <Gamepad2 size={20} />
                              ) : (
                                <SaveIcon size={19} />
                              )}
                            </span>
                            <div>
                              <strong title={item.name}>{item.name}</strong>
                              <small>
                                {item.kind === "game"
                                  ? `${SYSTEMS[item.game!.system].short} · ${item.game!.filename}`
                                  : `${item.game?.name || translate("未关联游戏")} · ${item.nativePath ? translate("游戏内存档") : item.save?.automatic ? translate("自动保存") : translate("手动存档")}`}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`storage-kind ${item.kind}`}>
                            {item.kind === "game"
                              ? translate("游戏")
                              : translate("存档")}
                          </span>
                        </td>
                        <td className="storage-size">
                          {formatSize(item.size)}
                        </td>
                        <td className="storage-date">
                          {formatDate(
                            item.save?.created || item.game?.added || 0,
                          )}
                        </td>
                        <td>
                          <div className="storage-row-actions">
                            {item.save && item.game && (
                              <button
                                className="icon-button"
                                aria-label={translate("导出 {{value0}}", {
                                  value0: item.name,
                                })}
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    if (item.nativePath)
                                      download(
                                        item.save!.data,
                                        item.nativePath.split("/").pop()!,
                                      );
                                    else
                                      await exportSave(item.save!, item.game!);
                                  })
                                }
                              >
                                <Download size={16} />
                              </button>
                            )}
                            <button
                              className="icon-button danger-text"
                              aria-label={translate("清理 {{value0}}", {
                                value0: item.name,
                              })}
                              disabled={busy}
                              onClick={() =>
                                chooseDelete(
                                  item.kind === "game"
                                    ? { gameIds: [item.id] }
                                    : { saveIds: [item.id] },
                                )
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty compact">
                <Check size={32} />
                <h3>
                  {query
                    ? translate("没有找到这个文件")
                    : filter === "large"
                      ? translate("没有需要清理的大文件")
                      : translate("这里暂时没有文件")}
                </h3>
                <p>
                  {filter === "large" && !query
                    ? translate("目前没有 32 MB 以上的大文件。")
                    : translate("试试其他分类，或换个名称搜索。")}
                </p>
              </div>
            )}
          </section>
        </>
      )}
      {biosOpen && snapshot && (
        <Modal
          title={translate("PSX 启动文件")}
          description={translate(
            "为喜欢的游戏做好准备，添加一次就能随时使用。",
          )}
          className="bios-modal"
          autoFocus
          onClose={() => {
            if (!busy) setBiosOpen(false);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            biosTrigger.current?.focus();
          }}
        >
          {snapshot.bios && (
            <div className="bios-file" role="status">
              <div className="cleanup-icon purple">
                <Gamepad2 size={22} />
              </div>
              <div className="bios-copy">
                <strong>{snapshot.bios.name}</strong>
                <p>
                  {formatSize(snapshot.bios.data.size)} · {translate("已就绪")}
                </p>
              </div>
              <Check className="bios-ready" size={18} />
            </div>
          )}
          <input
            hidden
            ref={biosInput}
            type="file"
            accept=".bin"
            disabled={busy}
            aria-label={translate("选择 PSX 启动文件")}
            onChange={(event) => {
              addBios(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className={`drop-zone bios-drop-zone ${biosDragging ? "dragging" : ""}`}
            disabled={busy}
            aria-label={
              snapshot.bios ? translate("更换文件") : translate("添加文件")
            }
            aria-describedby="bios-file-hint"
            aria-busy={busy}
            onClick={() => biosInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = busy ? "none" : "copy";
              if (!busy && event.dataTransfer.types.includes("Files"))
                setBiosDragging(true);
            }}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget as Node | null)
              )
                setBiosDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setBiosDragging(false);
              addBios(event.dataTransfer.files);
            }}
          >
            <span className="bios-upload-icon" aria-hidden="true">
              {busy ? (
                <LoaderCircle className="spin" size={28} />
              ) : (
                <Upload size={28} />
              )}
            </span>
            <strong>
              {busy
                ? translate("正在保存…")
                : biosDragging
                  ? translate("松开即可添加")
                  : snapshot.bios
                    ? translate("点击更换，或把新文件拖到这里")
                    : translate("点击选择，或把文件拖到这里")}
            </strong>
            <span id="bios-file-hint">
              {translate("一个 .bin 文件 · 512 KB")}
            </span>
          </button>
          {biosError && (
            <p className="bios-error error-text" role="alert">
              {biosError}
            </p>
          )}
          <p className="bios-local-note">
            <ShieldCheck size={14} aria-hidden="true" />
            {translate(isDesktop ? "文件只保存在这台设备" : "文件只保存在当前浏览器")}
          </p>
          <p className="bios-rights-note">
            {translate(importRightsNotice || "")}
          </p>
          <div className="modal-actions bios-actions">
            {snapshot.bios && (
              <button
                className="button secondary danger-text"
                disabled={busy}
                onClick={() =>
                  setPending({
                    title: translate("移除 PSX 启动文件？"),
                    description: translate(
                      "部分 PSX 游戏可能需要重新添加这个文件才能游玩。游戏和存档会保留。",
                    ),
                    cleanup: { bios: true },
                  })
                }
              >
                <Trash2 size={16} />
                {translate("移除 PSX 启动文件")}
              </button>
            )}
            <button
              className="button"
              disabled={busy}
              onClick={() => setBiosOpen(false)}
            >
              {translate("完成")}
            </button>
          </div>
        </Modal>
      )}
      {pending && snapshot && (
        <Modal
          title={pending.title}
          description={pending.description}
          onClose={() => {
            if (!busy) setPending(null);
          }}
        >
          <div className="cleanup-summary">
            <HardDrive size={22} />
            <div>
              <span>{translate("预计腾出空间")}</span>
              <strong>
                {formatSize(cleanupBytes(snapshot, pending.cleanup))}
              </strong>
            </div>
          </div>
          {!!cleanupItems(snapshot, pending.cleanup).length && (
            <ul className="cleanup-preview">
              {cleanupItems(snapshot, pending.cleanup).map((item) => (
                <li key={itemKey(item)}>
                  <span>
                    {item.kind === "game"
                      ? translate("游戏")
                      : translate("存档")}{" "}
                    · {item.name}
                  </span>
                  <small>{formatSize(item.size + item.coverSize)}</small>
                </li>
              ))}
            </ul>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              {translate("再想想")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await cleanStorage(pending.cleanup);
                  setPending(null);
                  setSelected(new Set());
                  await refresh();
                  await load();
                  notify(translate("清理完成，空间已经腾出来了"));
                })
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Trash2 size={16} />
              )}
              {translate("确认清理")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
