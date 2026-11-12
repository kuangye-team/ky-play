import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopDist, releaseVersion } from "./desktop-config.mjs";

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export function publishDesktopRelease(directory, version, runGh = gh) {
  const tag = `v${releaseVersion(version)}`;
  const names = readdirSync(directory);
  if (!names.includes("latest.json") || names.length < 2)
    throw new Error("Release artifacts and latest.json are required");
  const assets = names.filter((name) => name !== "latest.json").map((name) => resolve(directory, name));
  const manifest = resolve(directory, "latest.json");
  for (const path of [...assets, manifest]) {
    const file = statSync(path);
    if (!file.isFile() || !file.size) throw new Error(`Missing or empty release artifact: ${path}`);
  }

  let existing;
  try { existing = JSON.parse(runGh("release", "view", tag, "--json", "isDraft")); }
  catch (error) {
    if (!/release not found|HTTP 404/.test(error.stderr?.toString() || "")) throw error;
  }
  if (!existing) runGh("release", "create", tag, "--verify-tag", "--draft", "--title", `ky-play ${tag}`, "--generate-notes");
  // Reuse pre-created releases and replace same-name assets when retrying.
  runGh("release", "upload", tag, ...assets, "--clobber");
  // Published releases are already visible. Upload the manifest separately
  // so the new manifest is only available after its packages are ready.
  runGh("release", "upload", tag, manifest, "--clobber");
  if (!existing || existing.isDraft) runGh("release", "edit", tag, "--draft=false");
  return tag;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const tag = publishDesktopRelease(desktopDist, process.env.RELEASE_VERSION || "");
    console.log(`Published ${tag} with installers and latest.json`);
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exitCode = 1;
  }
}
