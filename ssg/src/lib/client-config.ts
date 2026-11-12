/** Public web and desktop entry points, resolved when the frontend is built. */
export const CLIENT_CONFIG = {
  webUrl: import.meta.env.VITE_WEB_URL?.trim() || "https://play.kuangye.team/",
  downloadUrl: import.meta.env.VITE_CLIENT_DOWNLOAD_URL?.trim() || "https://github.com/kuangye-team/ky-play/releases/latest",
  releaseUrl: import.meta.env.VITE_API_LATEST?.trim() || "https://github.com/kuangye-team/ky-play/releases/latest/download/latest.json",
  // Keep the scheme in sync with app/tauri.conf.json.
  launchUrl: "ky-play://open",
} as const;
