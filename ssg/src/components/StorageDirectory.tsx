import { useEffect, useState } from "react";
import { FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { database } from "../lib/storage/index";
import type { StorageInfo } from "../lib/storage/adapter";
import { translate } from "../lib/i18n";
import { Modal } from "./Modal";

export function StorageDirectory({ busy, setBusy, refresh, notify }: {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void database.then((db) => db.getStorageInfo!()).then((next) => {
      if (current) setInfo(next);
    }).catch(() => {
      if (current) setError(translate("暂时无法读取存储目录，请重试。"));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [version]);

  const choose = async () => {
    if (busy || !info) return;
    setError("");
    setBusy(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const directory = await open({ directory: true, multiple: false, defaultPath: info.directory });
      if (directory && directory !== info.directory) setPending(directory);
    } catch {
      setError(translate("暂时无法选择文件夹，请重试。"));
    } finally {
      setBusy(false);
    }
  };
  const migrate = async () => {
    if (!pending || busy) return;
    setMoving(true);
    setBusy(true);
    setError("");
    try {
      const next = await (await database).moveStorage!(pending);
      setInfo(next);
      setPending(null);
      notify(translate(next.cleanupWarning
        ? "数据已迁移，原目录中的旧数据未能清理，请稍后手动清理。"
        : "数据存储目录已迁移"));
      await refresh().catch(() => notify(translate("暂时无法读取占用情况，请重试。")));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate("迁移没有完成，原目录未改变。请检查文件夹权限和可用空间后重试。"));
    } finally {
      setMoving(false);
      setBusy(false);
    }
  };

  return <>
    <section className="storage-directory" aria-labelledby="storage-directory-title" aria-busy={loading || moving}>
      <div className="storage-directory-heading">
        <h2 id="storage-directory-title"><FolderOpen size={20} aria-hidden="true" />{translate("数据存储目录")}</h2>
        <button className="button secondary" disabled={busy || loading || !info} onClick={() => void choose()}>
          {translate("修改目录")}
        </button>
      </div>
      <p className="storage-directory-path">{info?.directory || translate(loading ? "读取中…" : "暂时无法读取存储目录，请重试。")}</p>
      <p className="storage-directory-description">{translate("游戏、存档和设置保存在此目录。修改目录会一起迁移已有数据。")}</p>
      {error && !pending && <div className="storage-directory-error" role="alert">
        <p>{error}</p>
        {!info && <button className="button secondary" disabled={busy || loading} onClick={() => setVersion((value) => value + 1)}>
          <RefreshCw size={15} aria-hidden="true" />{translate("重新读取")}
        </button>}
      </div>}
    </section>
    {pending && <Modal
      title={translate("迁移数据存储目录")}
      description={translate("请选择空文件夹。迁移完成后会使用新目录，并清理原目录中的游戏、存档和设置。迁移期间请勿退出应用。")}
      onClose={() => { if (!moving) { setPending(null); setError(""); } }}
    >
      <p className="storage-directory-path">{pending}</p>
      {error && <p className="storage-directory-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="button secondary" disabled={moving} onClick={() => { setPending(null); setError(""); }}>{translate("取消")}</button>
        <button className="button primary" disabled={busy} onClick={() => void migrate()}>
          {moving && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
          {translate(moving ? "正在迁移…" : "开始迁移")}
        </button>
      </div>
    </Modal>}
  </>;
}
