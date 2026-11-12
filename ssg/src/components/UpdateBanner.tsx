import { useRef, useSyncExternalStore } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { applyAppUpdate, dismissAppUpdate, getAppUpdate, subscribeAppUpdate } from "../lib/app-updates";
import { isDesktop, isDesktopExporting } from "../lib/desktop";
import "./UpdateBanner.css";

const busyMessage = "请先保存游戏进度并退出游戏，完成当前操作后再更新。";

// Read current state again when the worker activates, including after SPA navigation.
export function beforeAppReload(busy: boolean) {
  return busy || (isDesktop ? location.hash.slice(1) : location.pathname).startsWith("/play/") ||
    isDesktopExporting() || document.querySelector('[role="dialog"]:not(.desktop-update-dialog)')
    ? busyMessage : null;
}

export function UpdateBanner({ busy }: { busy: boolean }) {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const { t } = useTranslation();
  const update = useSyncExternalStore(subscribeAppUpdate, getAppUpdate);
  if (!update.available || update.dismissed) return null;
  return (
    <section className="update-banner" aria-label={t(isDesktop ? "应用更新" : "网站更新")}>
      <RefreshCw size={21} aria-hidden="true" />
      <div className="update-banner-copy" role="status" aria-atomic="true">
        <strong>{t("拾光有新版本了")}</strong>
        <p>{t(busy ? busyMessage : update.error || (isDesktop ? "新版本已准备好，更新后将重新打开拾光。" : "更新后即可使用，页面将重新加载。"))}</p>
      </div>
      <div className="update-banner-actions">
        <button className="button secondary" disabled={update.updating} onClick={dismissAppUpdate}>
          {t("稍后")}
        </button>
        <button className="button primary" disabled={busy || update.updating}
          onClick={() => void applyAppUpdate(() => beforeAppReload(busyRef.current))}>
          {update.updating && <LoaderCircle size={16} className="update-banner-spinner" aria-hidden="true" />}
          {t(update.updating ? "正在更新…" : isDesktop ? "更新并重启" : "更新并刷新")}
        </button>
      </div>
    </section>
  );
}
