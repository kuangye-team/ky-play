import { translate } from "../lib/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import {
  BookOpen,
  ChevronRight,
  Download,
  ExternalLink,
  Heart,
  Mail,
} from "lucide-react";
import { importRightsNotice, siteInfo } from "../lib/site-info";
import "../legal.css";
import { isDesktop } from "../lib/desktop";
import { download } from "../lib/storage";
import { Modal } from "./Modal";

type LicenseEntry = {
  id: string;
  name: string;
  version: string;
  license: string;
  group: "game" | "emulator" | "core" | "web";
  projectUrl: string;
  text: string;
  licenseUrl: string;
  sourceUrl?: string;
  downloadUrl?: string;
  note?: string;
};

function ExternalLinkTo({
  href,
  children,
  licenseText,
}: {
  href: string;
  children: ReactNode;
  licenseText?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  if (isDesktop && licenseText !== undefined) {
    return <>
      <a href={href} onClick={(event) => {
        event.preventDefault();
        setText(licenseText);
      }}>{children}<ExternalLink size={13} aria-hidden="true" /></a>
      {text !== null && <Modal title={translate("许可全文")} onClose={() => setText(null)} wide>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{text}</pre>
      </Modal>}
    </>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

function LegalHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
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

export function AboutPage() {
  const { hash } = useLocation();
  const [entries, setEntries] = useState<LicenseEntry[]>([]);
  const [noticesUrl, setNoticesUrl] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    const textUrl = (text: string) => {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      urls.push(url);
      return url;
    };
    setEntries([]);
    setNoticesUrl("");
    setLoading(true);
    setError(false);
    fetch(import.meta.env.VITE_LICENSE_INDEX_URL, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("License list unavailable");
        const data = await response.json();
        if (!Array.isArray(data.entries) || data.entries.some((entry: LicenseEntry) => typeof entry.text !== "string"))
          throw new Error("Invalid license list");
        if (controller.signal.aborted) return;
        setEntries(data.entries.map((entry: LicenseEntry) => ({ ...entry, licenseUrl: textUrl(entry.text) })));
        setNoticesUrl(textUrl(data.entries.map((entry: LicenseEntry) =>
          `${entry.name}${entry.version ? ` ${entry.version}` : ""}\n${entry.license}\n${entry.projectUrl}\n\n${entry.text}`,
        ).join("\n\n" + "=".repeat(72) + "\n\n")));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attempt]);
  useEffect(() => {
    if (!loading && hash)
      document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [loading, hash]);

  const cards = (group: LicenseEntry["group"]) => (
    <div className="license-grid">
      {entries
        .filter((entry) => entry.group === group)
        .map((entry) => (
          <article className="license-card" key={entry.id} id={entry.id}>
            <div className="license-card-heading">
              <h3>{entry.group === "game" ? translate(entry.name) : entry.name}</h3>
              <span>{translate(entry.version)}</span>
            </div>
            <p className="license-name">{translate(entry.license || "")}</p>
            {entry.note && (
              <p className="license-note">{translate(entry.note || "")}</p>
            )}
            <div className="legal-links">
              <ExternalLinkTo href={entry.licenseUrl} licenseText={entry.text}>
                {translate("许可全文")}
              </ExternalLinkTo>
              <ExternalLinkTo href={entry.projectUrl}>
                {translate("项目主页与源码")}
              </ExternalLinkTo>
              {entry.downloadUrl && (
                <a href={entry.downloadUrl} download>{translate("下载游戏文件")}</a>
              )}
              {entry.sourceUrl && (
                <a href={entry.sourceUrl} download>{translate("下载对应源码")}</a>
              )}
            </div>
          </article>
        ))}
    </div>
  );

  return (
    <article className="legal-page">
      <LegalHeading
        title={translate("开源许可")}
        subtitle={translate(
          "本项目离不开开源社区的慷慨奉献，衷心感谢本项目所依赖的所有开源项目及其背后的贡献者！",
        )}
      />
      <div className="legal-two-columns">
        <section className="legal-card">
          <h2>
            <Heart size={19} />
            {translate("关于使用")}
          </h2>
          <p>{translate(importRightsNotice || "")}</p>
          <p>
            {translate(
              "拾光不隶属于所支持游戏机的品牌方，也不代表这些品牌获得官方授权。相关名称仅用于说明兼容的游戏平台。",
            )}
          </p>
        </section>
        <section className="legal-card">
          <h2>
            <Mail size={19} />
            {translate("联系与反馈")}
          </h2>
          <p>
            {translate("使用问题、隐私请求或版权相关反馈，都可以联系")}
            {translate(siteInfo.operator || "")}
            {translate(
              "。请描述相关页面和问题，避免在邮件中附上完整游戏或启动文件。",
            )}
          </p>
          <a className="legal-email" href={`mailto:${siteInfo.email}`}>
            {siteInfo.email}
          </a>
        </section>
      </div>
      <section className="legal-card">
        <div className="legal-card-header">
          <h2>
            <BookOpen size={19} />
            {translate("开源项目与许可")}
          </h2>
          <div className="legal-links legal-download">
            {noticesUrl && <a href={noticesUrl} download="THIRD-PARTY-NOTICES.txt" onClick={isDesktop ? (event) => {
              event.preventDefault();
              void fetch(noticesUrl).then((response) => response.blob())
                .then((blob) => download(blob, "THIRD-PARTY-NOTICES.txt"));
            } : undefined}>
              <Download size={16} />
              {translate("下载全部许可说明")}
            </a>}
          </div>
        </div>
        <p>
          {translate(
            "感谢以下项目的作者与贡献者。各项目的版权归原作者所有。如果你想使用、修改或分享这些项目，请阅读各自的许可全文，了解具体要求。",
          )}
        </p>
        <p>
          {translate(
            "部分项目仅限非商业用途。拾光免费提供服务，各项目原有的使用限制仍然适用。",
          )}
        </p>
        {loading ? (
          <p className="legal-status" role="status">
            {translate("正在打开许可列表…")}
          </p>
        ) : error ? (
          <div className="legal-status" role="alert">
            <p>{translate("许可列表暂时没有加载成功，请稍后重试。")}</p>
            <button
              className="small-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {translate("重试")}
            </button>
          </div>
        ) : (
          <>
            <h3 className="legal-group-title">{translate("随站游戏")}</h3>
            {cards("game")}
            <h3 className="legal-group-title">{translate("模拟器")}</h3>
            {cards("emulator")}
            <h3 className="legal-group-title">
              {translate("支持各类游戏的项目")}
            </h3>
            {cards("core")}
            <details className="legal-dependencies">
              <summary>
                {translate("网站使用的其他项目")}{" "}
                <span>
                  {entries.filter((entry) => entry.group === "web").length}
                  {translate("项")}
                </span>
              </summary>
              {cards("web")}
            </details>
          </>
        )}
      </section>
      <p className="legal-endnote">
        {translate("想了解文件如何保存？")}
        <Link to="/privacy">
          {translate("阅读隐私说明")}
          <ChevronRight size={14} />
        </Link>
      </p>
    </article>
  );
}

export function PrivacyPage({ onStorage }: { onStorage: () => void }) {
  return (
    <article className="legal-page">
      <LegalHeading
        title={translate("隐私说明")}
        subtitle={translate(
          "了解游戏、存档和访问记录如何保存。更新于 {{value0}}。",
          { value0: translate(siteInfo.updated) },
        )}
      />
      <section className="legal-card">
        <h2>{translate("1. 保存在你设备上的内容")}</h2>
        <p>
          {translate(
            isDesktop ? "游戏、存档、截图和设置保存在本机应用中，用于整理游戏库和恢复进度，不会上传或自动同步到其他设备。网页版与客户端的游戏库相互独立。" : "你添加的游戏、封面和启动文件，以及存档、游戏截图、收藏、标签、最近游玩记录、游玩时长和按键设置，保存在当前浏览器中，用于运行游戏、整理游戏库和恢复进度。网站不会把这些文件和记录上传到服务器，也不会自动同步到其他设备。",
          )}
        </p>
        <p>
          {translate(
            isDesktop ? "语言和主题偏好保存在本机，方便下次打开时沿用。" : "语言和主题偏好也会保存在当前浏览器，方便下次打开时沿用。",
          )}{" "}
        </p>
        <p>
          {translate(isDesktop ? "应用内置界面和附赠游戏，断网时也能查看游戏库。开始游戏可能仍需联网下载所需文件。" : "浏览器还会保存网站页面、图标和必要的界面文件，方便下次打开，断网时也能查看游戏库。开始游戏可能仍需联网下载所需文件。")}
        </p>
        <p>
          {translate(
            "只有你选择或拖入页面的文件才会被读取。键盘、触控和手柄输入用于操作当前游戏与页面，不会作为使用记录上传。",
          )}
        </p>
        <p>
          {translate(
            isDesktop ? "清理应用数据或存储空间不足可能导致内容丢失，重要存档请提前导出。" : "无痕浏览、清理浏览器数据、存储空间不足等情况可能导致内容丢失，重要存档请提前导出。",
          )}
        </p>
      </section>
      <section className="legal-card">
        <h2>{translate(isDesktop ? "2. 检查应用更新" : "2. 访问网站时产生的信息")}</h2>
        {isDesktop ? <p>{translate("应用会访问配置的更新服务检查新版本，并在你确认后下载更新。更新服务会收到版本、设备类型和访问网络信息，不会收到你的游戏或存档。")}</p> : <>
        <p>
          {translate(
            "网站使用 Cloudflare 托管和提供访问服务。打开网站时，Cloudflare 可能处理你的 IP 地址、请求时间、访问地址、浏览器或设备信息及安全事件信息，用于交付网页、维护服务和防范攻击。这些访问数据与保存在设备上的游戏文件不同。",
          )}
        </p>
        <p>
          {translate(
            "Cloudflare 的部分安全功能可能使用 Cookie 来识别风险或记住验证结果。你可以在浏览器设置中管理 Cookie；禁用后可能需要重新完成访问验证。",
          )}
        </p>
        <div className="legal-links">
          <ExternalLinkTo href="https://www.cloudflare.com/privacypolicy/">
            {translate("Cloudflare 隐私政策")}
          </ExternalLinkTo>
          <ExternalLinkTo href="https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/">
            {translate("Cloudflare Cookie 说明")}
          </ExternalLinkTo>
        </div>
        </>}
      </section>
      <section className="legal-card">
        <h2>{translate("3. 其他网络访问")}</h2>
        <p>
          {translate(isDesktop ? "附赠游戏随应用提供，首次游玩时加入本机游戏库。移除后不会自动加回。" : "首次游玩附赠游戏时，会从本站下载游戏并保存在当前浏览器，方便下次游玩。你可以在游戏库中移除它们；移除后不会自动加回。")}
        </p>
        <p>
          {translate(
            isDesktop && import.meta.env.VITE_EMULATOR_BASE_URL.startsWith("/")
              ? "游戏所需的模拟器程序随应用提供，游玩时无需另行下载。"
              : "游戏所需的模拟器程序从本站或配置的资源服务加载。资源服务会收到这次访问的网络信息，但不会收到你添加的游戏或存档。",
          )}
        </p>
        <p>
          {translate(
            "项目主页、源码和隐私政策等外部链接，只有在你点击后才会打开。访问这些外部网站时，请同时阅读对方的隐私说明。",
          )}
        </p>
      </section>
      <section className="legal-card">
        <h2>{translate("4. 如何查看、导出和删除")}</h2>
        <p>
          {translate(
            "你可以在游戏库中查看或修改游戏信息，在“我的存档”中导出或删除存档，在“存储管理”中删除游戏、存档和启动文件。下载到设备上的导出文件由你自行保管。",
          )}
        </p>
        <p>
          {translate(
            isDesktop ? "可在“存储管理”中删除本机游戏与存档。清理应用数据前，请先导出重要存档；更换设备后，本地内容不会自动带过去。" : "如需移除本站保存在浏览器中的全部内容，可在浏览器设置中清除本站的网站数据。这也会移除收藏、标签和按键设置，清除前请先导出重要存档。更换浏览器或设备后，本地内容不会自动带过去。",
          )}
        </p>
        <button className="small-button" onClick={onStorage}>
          {translate("前往存储管理")}
          <ChevronRight size={15} />
        </button>
      </section>
      <section className="legal-card">
        <h2>{translate("5. 联系我们与隐私请求")}</h2>
        <p>
          {translate("运营者：")}
          {translate(siteInfo.operator || "")}
          {translate("。你可以通过")}{" "}
          <a className="legal-inline-link" href={`mailto:${siteInfo.email}`}>
            {siteInfo.email}
          </a>{" "}
          {translate(
            "咨询信息处理方式，提出查阅、更正、删除等请求，或反馈隐私问题。",
          )}
        </p>
        <p>
          {translate(
            "你主动发送邮件时，我们会收到你的邮箱地址、邮件内容及你提供的附件，仅用于处理和回复相关事项。请只提供处理问题所必需的信息，不要发送身份证件、完整游戏文件等无关内容。",
          )}
        </p>
        <p>
          {translate(
            "对于仅保存在你设备上的游戏与记录，我们无法查看、导出或代为删除；你可以按照上面的方式自行管理。",
          )}
        </p>
      </section>
      <section className="legal-card">
        <h2>{translate("6. 未成年人和说明更新")}</h2>
        <p>
          {translate(
            "未成年人请在监护人的指导下使用本站，合理安排游玩时间。",
          )}
        </p>
        <p>
          {translate(
            "当前网站不要求注册账号，不设置广告或付费入口。若以后新增账号、云端保存、访问统计或其他信息处理方式，我们会先更新说明，并在依法需要时另行告知、征得同意。阅读本说明本身不视为你同意任何新增的信息处理。",
          )}
        </p>
      </section>
      <p className="legal-endnote">
        {translate("还想了解拾光？")}
        <Link to="/about">
          {translate("开源许可")}
          <ChevronRight size={14} />
        </Link>
      </p>
    </article>
  );
}
