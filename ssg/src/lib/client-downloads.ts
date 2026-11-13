import { CLIENT_CONFIG } from "./client-config";

export type DesktopPlatform = "windows" | "macos";
export type ClientRelease = {
  version: string;
  downloads: Partial<Record<DesktopPlatform, string>>;
};

export function detectDesktopPlatform(device: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform: string };
}): DesktopPlatform | undefined {
  const platform = device.userAgentData?.platform || device.platform || "";
  // iPadOS can advertise itself as a Mac; mobile devices have no desktop client.
  if (/Android|iPhone|iPad|iPod/i.test(device.userAgent) ||
      (/Mac/i.test(platform) && (device.maxTouchPoints || 0) > 1)) return;
  if (/Win/i.test(platform) || /Windows/i.test(device.userAgent)) return "windows";
  if (/Mac/i.test(platform) || /Macintosh/i.test(device.userAgent)) return "macos";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function installerUrl(value: unknown, version: string, platform: DesktopPlatform): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    // Release manifests reference the macOS updater archive; its matching DMG
    // is published alongside it for new installations.
    if (platform === "macos") url.pathname = url.pathname.replace(/\.app\.tar\.gz$/, ".dmg");
    const suffix = platform === "macos" ? "universal.dmg" : "x64-setup.exe";
    if (url.pathname.endsWith(`/ky-play-${version}-${suffix}`)) return url.href;
  } catch { /* Ignore unusable download links. */ }
}

export function parseClientRelease(value: unknown): ClientRelease {
  const release = record(value);
  const version = typeof release.version === "string" ? release.version :
    typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : "";
  if (!/^\d+\.\d+\.\d+$/.test(version) || release.draft || release.prerelease)
    throw new Error("Invalid client release");
  const assets = Array.isArray(release.assets) ? release.assets.map(record) : [];
  const platforms = record(release.platforms);
  const installers = record(release.downloads);
  const downloads: ClientRelease["downloads"] = {};
  for (const [platform, suffix] of [["macos", "universal.dmg"], ["windows", "x64-setup.exe"]] as const) {
    const asset = assets.find((item) => item.name === `ky-play-${version}-${suffix}`);
    const keys = platform === "macos" ? ["darwin-aarch64", "darwin-x86_64"] : ["windows-x86_64"];
    for (const candidate of [installers[platform], ...keys.map((key) => record(platforms[key]).url), asset?.browser_download_url]) {
      const url = installerUrl(candidate, version, platform);
      if (url) { downloads[platform] = url; break; }
    }
  }
  if (!Object.keys(downloads).length) throw new Error("Invalid client release");
  return { version, downloads };
}

let pending: Promise<ClientRelease> | undefined;
export function loadClientRelease(): Promise<ClientRelease> {
  // Share successful requests across hover/focus events; allow failed requests to retry.
  return pending ??= Promise.resolve().then(() => fetch(CLIENT_CONFIG.releaseUrl, {
    signal: AbortSignal.timeout(12_000),
    credentials: "omit",
  })).then(async (response) => {
    if (!response.ok) throw new Error("Client release unavailable");
    return parseClientRelease(await response.json());
  }).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
}
