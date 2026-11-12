import { translate } from "../lib/i18n";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Keyboard,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { siteInfo } from "../lib/site-info";
import { CLIENT_CONFIG } from "../lib/client-config";
import { Modal } from "./Modal";
import { isDesktop } from "../lib/desktop";
import {
  checkDesktopUpdate,
  desktopUpdaterEnabled,
  getAppUpdate,
  loadDesktopVersion,
  subscribeAppUpdate,
} from "../lib/desktop-updates";

function DesktopVersion({ onUpdate, updateBusy }: { onUpdate: () => void; updateBusy: boolean }) {
  const update = useSyncExternalStore(subscribeAppUpdate, getAppUpdate);
  useEffect(() => { void loadDesktopVersion(); }, []);

  const status = !desktopUpdaterEnabled ? "此版本暂不支持在线更新"
    : update.installed ? "更新已安装，请关闭并重新打开拾光。"
    : update.updating ? "正在更新…"
    : update.checking ? "正在检查更新…"
    : update.checkError || (update.available ? "有新版本可更新" : update.checked ? "已是最新版本" : "尚未检查更新");

  return (
    <section className="about-version" aria-label={translate("应用版本")}>
      <div className="about-version-info" role="status" aria-atomic="true">
        <span className="about-current-version">
          {translate("当前版本")}
          <strong>{update.currentVersion ? `v${update.currentVersion}` : translate(update.versionError ? "暂时无法读取版本" : "读取中…")}</strong>
        </span>
        <span className={`about-update-status${update.available ? " has-update" : ""}`}>
          {translate(status)}
        </span>
        {update.available && <span className="about-latest-version">{translate("可更新至 {{version}}", { version: `v${update.version}` })}</span>}
      </div>
      <div className="about-version-actions">
        <button
          className="button secondary"
          disabled={!desktopUpdaterEnabled || update.checking || update.updating || update.installed}
          onClick={() => { void loadDesktopVersion(); void checkDesktopUpdate({ manual: true }); }}
        >
          {update.checking ? <LoaderCircle size={15} className="update-banner-spinner" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
          {translate(update.checking ? "正在检查更新…" : "检查更新")}
        </button>
        {update.available && !update.installed && <>
          <a
            className="button secondary"
            href={CLIENT_CONFIG.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {translate("前往更新")}
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          <button
            className="button primary"
            disabled={updateBusy || update.updating || update.checking}
            onClick={onUpdate}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {translate("更新并重启")}
          </button>
        </>}
      </div>
    </section>
  );
}

export function AboutModal({ onClose, onUpdate, updateBusy }: {
  onClose: () => void;
  onUpdate: () => void;
  updateBusy: boolean;
}) {
  const [copyMessage, setCopyMessage] = useState("");

  return (
    <Modal
      title={translate("关于拾光")}
      description={translate("桂花载酒，与少年游。")}
      headingContent={isDesktop ? <DesktopVersion onUpdate={onUpdate} updateBusy={updateBusy} /> : undefined}
      className="about-modal"
      onClose={onClose}
    >
      <div className="about-columns">
        <div className="about-guide">
          <section>
            <Upload size={23} aria-hidden="true" />
            <div>
              <h3>{translate("添加游戏，随时开玩")}</h3>
              <p>
                {translate(
                  "可以先玩玩附赠的《小镇反弹道导弹》和《无限奔跑》，也可以点击「从设备添加游戏」，选择你有权使用的游戏文件，放进游戏库。",
                )}
              </p>
            </div>
          </section>
          <section>
            <Keyboard size={23} aria-hidden="true" />
            <div>
              <h3>{translate("键盘、手柄，都能玩")}</h3>
              <p>
                {translate(
                  "方向键移动，X 和 Z 操作，Enter 开始。游玩时可以查看按键提示， 也可以在「外设设置」中换成习惯的按键，或连接手柄。",
                )}
              </p>
            </div>
          </section>
          <section>
            <Save size={23} aria-hidden="true" />
            <div>
              <h3>{translate("保存进度，下次接着玩")}</h3>
              <p>
                {translate(
                  "点击「保存进度」就能存档，返回游戏库时也会自动保存。 想换台设备继续玩，可以先导出存档，再到新设备上导入。",
                )}
              </p>
            </div>
          </section>
          <section>
            <ShieldCheck size={23} aria-hidden="true" />
            <div>
              <h3>{translate("游戏和存档，留在你手里")}</h3>
              <p>
                {translate(
                  isDesktop ? "游戏和存档只保存在本机应用中，不会上传，也不会自动同步。重要存档记得导出备份。" : "游戏和存档只保存在当前浏览器，不会上传，也不会自动同步。 清理浏览器数据或使用无痕模式可能丢失进度，重要存档记得导出备份。",
                )}
              </p>
            </div>
          </section>
        </div>
        <aside className="about-contact" aria-labelledby="about-contact-title">
          <h3 id="about-contact-title">{translate("联系我们")}</h3>
          <p>
            {translate("拾光由")}
            {translate(siteInfo.operator || "")}
            {translate("维护。如果有使用问题、建议或合作想法，欢迎联系我们。")}
          </p>
          <dl>
            <div>
              <dt>{translate("主页")}</dt>
              <dd className="about-copyable">
                <a
                  href={siteInfo.homeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{siteInfo.homeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
                <button
                  className="icon-button"
                  aria-label={translate("复制主页网址")}
                  title={translate("复制主页网址")}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(siteInfo.homeUrl);
                      setCopyMessage(translate("主页网址已复制"));
                    } catch {
                      setCopyMessage(
                        translate("没有复制成功，请选中网址后手动复制。"),
                      );
                    }
                  }}
                >
                  {copyMessage === translate("主页网址已复制") ? (
                    <Check size={16} />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </dd>
            </div>
            <div>
              <dt>{translate("源码")}</dt>
              <dd className="about-copyable">
                {siteInfo.sourceUrl ? (
                  <>
                    <a
                      href={siteInfo.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span>{siteInfo.sourceUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </a>
                    <button
                      className="icon-button"
                      aria-label={translate("复制源码网址")}
                      title={translate("复制源码网址")}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(siteInfo.sourceUrl);
                          setCopyMessage(translate("源码网址已复制"));
                        } catch {
                          setCopyMessage(
                            translate("没有复制成功，请打开源码页面后复制网址。"),
                          );
                        }
                      }}
                    >
                      {copyMessage === translate("源码网址已复制") ? (
                        <Check size={16} />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                  </>
                ) : (
                  translate("整理中，待上传到开源仓库。")
                )}
              </dd>
            </div>
            <div>
              <dt>{translate("邮箱")}</dt>
              <dd className="about-copyable">
                <a href={`mailto:${siteInfo.email}`}>
                  <span>{siteInfo.email}</span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
                <button
                  className="icon-button"
                  aria-label={translate("复制邮箱地址")}
                  title={translate("复制邮箱地址")}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(siteInfo.email);
                      setCopyMessage(translate("邮箱地址已复制"));
                    } catch {
                      setCopyMessage(
                        translate("没有复制成功，请选中邮箱地址后手动复制。"),
                      );
                    }
                  }}
                >
                  {copyMessage === translate("邮箱地址已复制") ? (
                    <Check size={16} />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </dd>
            </div>
          </dl>
          {copyMessage && (
            <p className="about-copy-message" role="status">
              {copyMessage}
            </p>
          )}
        </aside>
      </div>
      <div className="modal-actions">
        <button className="button" onClick={onClose}>
          {translate("开始玩吧")}
        </button>
      </div>
    </Modal>
  );
}
