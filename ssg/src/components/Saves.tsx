import { translate } from "../lib/i18n";
import {
  Download,
  FolderOpen,
  Play,
  Trash2,
  Upload,
  Pencil,
  Check,
} from "lucide-react";
import { useRef, useState } from "react";
import { exportSave, importSave, putSave, removeSave } from "../lib/storage";
import { saveBytes } from "../lib/storage-management";
import { formatSize, formatDate, type Game, type Save } from "../lib/types";
import { Modal } from "./Modal";
export function Saves({
  game,
  saves,
  onRefresh,
  onLoad,
  notify,
}: {
  game: Game;
  saves: Save[];
  onRefresh: () => Promise<void>;
  onLoad: (save: Save) => void;
  notify: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<Save | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="save-manager">
      <div className="save-head">
        <span>
          {saves.length}
          {translate("个存档")}
        </span>
        <button
          className="small-button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload size={15} />
          {translate("导入存档")}
        </button>
        <input
          ref={input}
          hidden
          type="file"
          accept=".kysave"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void run(async () => {
                await importSave(file, game);
                await onRefresh();
                notify(translate("存档已导入"));
              });
            e.target.value = "";
          }}
        />
      </div>
      {saves.length === 0 ? (
        <div className="empty compact">
          <FolderOpen size={36} />
          <h3>{translate("下一次，从这里继续")}</h3>
          <p>
            {translate("游玩时点击「保存进度」，")}
            <br />
            {translate("就能随时回到这一刻。")}
          </p>
        </div>
      ) : (
        <div className="save-list">
          {saves
            .sort((a, b) => b.created - a.created)
            .map((save) => (
              <article className="save-card" key={save.id}>
                {save.screenshot ? (
                  <img src={save.screenshot} alt={translate("存档画面")} />
                ) : (
                  <div className="save-placeholder">
                    <FolderOpen />
                  </div>
                )}
                <div className="save-info">
                  {editing === save.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (name.trim())
                          void run(async () => {
                            await putSave({ ...save, name: name.trim() });
                            setEditing(null);
                            await onRefresh();
                          });
                      }}
                    >
                      <input
                        aria-label={translate("存档名称")}
                        maxLength={60}
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      <button aria-label={translate("保存存档名称")}>
                        <Check size={16} />
                      </button>
                    </form>
                  ) : (
                    <strong>{save.name}</strong>
                  )}
                  <small>
                    {formatDate(save.created)} · {formatSize(saveBytes(save))}
                    {save.automatic ? translate(" · 自动保存") : ""}
                  </small>
                  <div className="save-actions">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => onLoad(save)}
                    >
                      <Play size={13} />
                      {translate("继续游戏")}
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={translate("重命名 {{value0}}", {
                        value0: save.name,
                      })}
                      onClick={() => {
                        setEditing(save.id);
                        setName(save.name);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={translate("下载 {{value0}}", {
                        value0: save.name,
                      })}
                      onClick={() => void run(() => exportSave(save, game))}
                    >
                      <Download size={14} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={translate("删除 {{value0}}", {
                        value0: save.name,
                      })}
                      onClick={() => setDeleting(save)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
        </div>
      )}
      <p className="subtle-note">
        {translate("存档留在当前浏览器。导出一份，也能带到另一台设备。")}
      </p>
      {deleting && (
        <Modal
          title={translate("删除这个存档？")}
          description={translate("「{{value0}}」删除后无法恢复。", {
            value0: deleting.name,
          })}
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
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await removeSave(deleting.id);
                  setDeleting(null);
                  await onRefresh();
                })
              }
            >
              {translate("删除存档")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
