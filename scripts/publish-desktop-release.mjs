import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { desktopDist, releaseVersion } from "./desktop-config.mjs";

const tag = `v${releaseVersion(process.env.RELEASE_VERSION || "")}`;
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
// A retry may complete a draft, but never replace an already published update.
let existing;
try { existing = JSON.parse(gh("release", "view", tag, "--json", "isDraft")); }
catch (error) {
  if (!/release not found|HTTP 404/.test(error.stderr?.toString() || "")) throw error;
}
if (existing && !existing.isDraft) throw new Error(`${tag} is already published; create a new version tag`);
if (!existing) gh("release", "create", tag, "--verify-tag", "--draft", "--title", `ky-play ${tag}`, "--generate-notes");
const assets = readdirSync(desktopDist).map((name) => resolve(desktopDist, name));
gh("release", "upload", tag, ...assets, "--clobber");
// Publishing only after upload prevents clients from seeing a partial manifest.
gh("release", "edit", tag, "--draft=false");
console.log(`Published ${tag} with installers and latest.json`);
