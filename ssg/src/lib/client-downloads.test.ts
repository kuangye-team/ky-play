import { afterEach, expect, it, vi } from "vitest";
import { detectDesktopPlatform, parseClientRelease } from "./client-downloads";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it.each([
  [{ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32" }, "windows"],
  [{ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 0 }, "macos"],
  [{ userAgent: "Mozilla/5.0", userAgentData: { platform: "Windows" } }, "windows"],
  [{ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 }, undefined],
  [{ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS)", platform: "iPhone" }, undefined],
  [{ userAgent: "Mozilla/5.0 (Linux; Android 14)", platform: "Linux" }, undefined],
  [{ userAgent: "Mozilla/5.0 (X11; Linux x86_64)", platform: "Linux x86_64" }, undefined],
])("recommends supported desktop systems without mistaking an iPad for a Mac: %j", (device, expected) => {
  expect(detectDesktopPlatform(device)).toBe(expected);
});

const release = {
  tag_name: "v1.2.3",
  assets: ["universal.dmg", "universal.app.tar.gz", "x64-setup.exe", "x64-setup.exe.sig"].map((suffix) => ({
    name: `ky-play-1.2.3-${suffix}`,
    browser_download_url: `https://example.com/ky-play-1.2.3-${suffix}`,
  })),
};

const manifest = {
  version: "1.2.3",
  notes: "ky-play 1.2.3",
  pub_date: "2026-11-11T00:00:00.000Z",
  platforms: {
    "darwin-aarch64": { signature: "signature", url: "https://example.com/ky-play-1.2.3-universal.app.tar.gz" },
    "darwin-x86_64": { signature: "signature", url: "https://example.com/ky-play-1.2.3-universal.app.tar.gz" },
    "windows-x86_64": { signature: "signature", url: "https://example.com/ky-play-1.2.3-x64-setup.exe" },
  },
};

it("reads latest.json and resolves the macOS installer alongside its updater archive", () => {
  expect(parseClientRelease(manifest)).toEqual({ version: "1.2.3", downloads: {
    macos: "https://example.com/ky-play-1.2.3-universal.dmg",
    windows: "https://example.com/ky-play-1.2.3-x64-setup.exe",
  } });
  expect(parseClientRelease({ ...manifest, platforms: {
    "darwin-x86_64": manifest.platforms["darwin-x86_64"],
  } }).downloads).toEqual({ macos: "https://example.com/ky-play-1.2.3-universal.dmg" });
  expect(parseClientRelease({ ...manifest, downloads: {
    windows: "https://downloads.example.com/ky-play-1.2.3-x64-setup.exe",
  } }).downloads.windows).toBe("https://downloads.example.com/ky-play-1.2.3-x64-setup.exe");
});

it("accepts HTTP installers from local manifests and release assets", () => {
  const base = "http://host.docker.internal:10888/play";
  const downloads = {
    macos: `${base}/ky-play-1.2.3-universal.dmg`,
    windows: `${base}/ky-play-1.2.3-x64-setup.exe`,
  };
  expect(parseClientRelease({ ...manifest, platforms: {
    "darwin-aarch64": { url: `${base}/ky-play-1.2.3-universal.app.tar.gz` },
    "windows-x86_64": { url: downloads.windows },
  } }).downloads).toEqual(downloads);
  expect(parseClientRelease({ version: "1.2.3", downloads }).downloads).toEqual(downloads);
  expect(parseClientRelease({ ...release, assets: release.assets.map((asset) => ({
    ...asset, browser_download_url: `${base}/${asset.name}`,
  })) }).downloads).toEqual(downloads);
});

it.each([
  { ...manifest, version: "1.2.4" }, { ...manifest, version: "" }, { ...manifest, platforms: {} },
  ...["javascript:alert(1)", "https://user:password@example.com/ky-play-1.2.3-universal.app.tar.gz",
    "ftp://example.com/ky-play-1.2.3-universal.app.tar.gz", "http://user:password@example.com/ky-play-1.2.3-universal.app.tar.gz",
    "https://example.com/wrong.app.tar.gz"].map((url) => ({
    ...manifest, platforms: { "darwin-aarch64": { url } },
  })),
])("rejects incomplete manifests and unsafe installer URLs: %j", (value) => {
  expect(() => parseClientRelease(value)).toThrow("Invalid client release");
});

it("selects the published installers, excluding signatures and update archives", () => {
  expect(parseClientRelease(release)).toEqual({ version: "1.2.3", downloads: {
    macos: "https://example.com/ky-play-1.2.3-universal.dmg",
    windows: "https://example.com/ky-play-1.2.3-x64-setup.exe",
  } });
});

it.each([null, {}, { ...release, draft: true }, { ...release, prerelease: true },
  { ...release, tag_name: "v1.2.4" },
  ...["javascript:alert(1)", "https://user:password@example.com/ky-play-1.2.3-universal.dmg",
    "ftp://example.com/ky-play-1.2.3-universal.dmg", "http://user:password@example.com/ky-play-1.2.3-universal.dmg",
    "https://example.com/wrong.app.tar.gz"].map((url) => ({
    ...release, assets: [{ name: "ky-play-1.2.3-universal.dmg", browser_download_url: url }],
  })),
])("rejects unavailable installers and unsafe release URLs: %j", (value) => {
  expect(() => parseClientRelease(value)).toThrow("Invalid client release");
});

it.each(["", "  https://updates.example.com/latest  ", "http://host.docker.internal:10888/play/latest.json"])("shares successful requests and retries using the configured endpoint: %j", async (endpoint) => {
  vi.stubEnv("VITE_API_LATEST", endpoint);
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => manifest });
  vi.stubGlobal("fetch", fetchMock);
  const { loadClientRelease } = await import("./client-downloads");
  await expect(loadClientRelease()).rejects.toThrow();
  const one = loadClientRelease();
  expect(loadClientRelease()).toBe(one);
  await expect(one).resolves.toMatchObject({ version: "1.2.3" });
  await loadClientRelease();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledWith(endpoint.trim() || "https://github.com/kuangye-team/ky-play/releases/latest/download/latest.json", expect.objectContaining({ credentials: "omit" }));
});
