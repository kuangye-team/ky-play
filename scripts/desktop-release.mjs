import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopDist, desktopEnv, httpsUrl, productName, releaseVersion, root } from "./desktop-config.mjs";

export function collectArtifacts(bundleDir, output, target, version) {
  version = releaseVersion(version);
  const mac = target === "universal-apple-darwin";
  if (!mac && target !== "x86_64-pc-windows-msvc") throw new Error(`Unsupported target: ${target}`);
  // Tauri retains bundles from previous app names and versions. Select the
  // current product's exact paths instead of collecting every matching suffix.
  const artifacts = mac ? [
    [`dmg/${productName}_${version}_universal.dmg`, ".dmg"],
    [`macos/${productName}.app.tar.gz`, ".app.tar.gz"],
    [`macos/${productName}.app.tar.gz.sig`, ".app.tar.gz.sig"],
  ] : [
    [`nsis/${productName}_${version}_x64-setup.exe`, "-setup.exe"],
    [`nsis/${productName}_${version}_x64-setup.exe.sig`, "-setup.exe.sig"],
  ];
  for (const [path] of artifacts) {
    const source = resolve(bundleDir, path);
    if (!statSync(source, { throwIfNoEntry: false })?.isFile())
      throw new Error(`Missing release artifact: ${source}`);
  }
  mkdirSync(output, { recursive: true });
  for (const [path, suffix] of artifacts) {
    const name = `ky-play-${version}-${mac ? "universal" : "x64"}${suffix}`;
    copyFileSync(resolve(bundleDir, path), resolve(output, name));
  }
}
export function writeManifest(directory, version, env, complete = true) {
  version = releaseVersion(version);
  const repository = env.GITHUB_REPOSITORY || "kuangye-team/ky-play";
  const base = httpsUrl(env.TAURI_RELEASE_BASE_URL?.trim() ||
    `https://github.com/${repository}/releases/download/v${version}`, "TAURI_RELEASE_BASE_URL");
  if (new URL(base).search) throw new Error("TAURI_RELEASE_BASE_URL must be a directory URL without a query");
  const names = new Set(readdirSync(directory));
  const platforms = {};
  for (const [name, keys, installer] of [
    [`ky-play-${version}-universal.app.tar.gz`, ["darwin-aarch64", "darwin-x86_64"], `ky-play-${version}-universal.dmg`],
    [`ky-play-${version}-x64-setup.exe`, ["windows-x86_64"], `ky-play-${version}-x64-setup.exe`],
  ]) {
    if (!names.has(name)) {
      if (complete) throw new Error(`Missing update artifact: ${name}`);
      continue;
    }
    if (!names.has(installer) || !statSync(resolve(directory, name)).size || !statSync(resolve(directory, installer)).size)
      throw new Error(`Missing or empty installer/update: ${installer}`);
    const signature = readFileSync(resolve(directory, `${name}.sig`), "utf8").trim();
    if (!signature || !Buffer.from(signature, "base64").toString("utf8").startsWith("untrusted comment:"))
      throw new Error(`Invalid updater signature: ${name}.sig`);
    const entry = { signature, url: `${base.replace(/\/$/, "")}/${name}` };
    for (const key of keys) platforms[key] = entry;
  }
  if (!Object.keys(platforms).length) throw new Error("No update artifacts found");
  const manifest = { version, notes: env.RELEASE_NOTES || `ky-play ${version}`, pub_date: new Date().toISOString(), platforms };
  writeFileSync(resolve(directory, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = desktopEnv();
    writeManifest(desktopDist, env.RELEASE_VERSION || JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version, env);
    console.log("Generated app/dist/latest.json for macOS universal and Windows x64");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
