import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initialize } from "./init-env.mjs";
import { desktopBundleResources, desktopDist, desktopEnv, releaseVersion, root, updaterConfig } from "./desktop-config.mjs";
import { collectArtifacts, writeManifest } from "./desktop-release.mjs";
import { rustCacheEnv } from "./rust.mjs";

try {
  const [command = "dev", ...args] = process.argv.slice(2);
  if (!["dev", "build"].includes(command)) throw new Error("Use desktop.mjs dev or build");
  initialize();
  const env = rustCacheEnv(desktopEnv());
  // Cargo runs in app/, while artifact collection runs from the repository root.
  env.CARGO_TARGET_DIR = resolve(root, env.CARGO_TARGET_DIR || "temp/cache/cargo");
  // GitHub exposes unset optional secrets as empty strings. Tauri must see
  // absent notarization credentials, otherwise it may attempt an empty login.
  for (const key of ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID", "APPLE_SIGNING_IDENTITY"])
    if (!env[key]) delete env[key];
  const release = command === "build";
  const version = releaseVersion(env.RELEASE_VERSION || JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version);
  const config = { ...updaterConfig(env, release), version };
  config.bundle.resources = desktopBundleResources(env);
  const targetIndex = args.indexOf("--target");
  const target = targetIndex >= 0 ? args[targetIndex + 1] :
    process.platform === "darwin" ? "universal-apple-darwin" : "x86_64-pc-windows-msvc";
  if (release && !["universal-apple-darwin", "x86_64-pc-windows-msvc"].includes(target))
    throw new Error("Supported release targets: universal-apple-darwin, x86_64-pc-windows-msvc");
  if (release && args.some((arg) => ["--debug", "--no-bundle", "--config", "-c", "--bundles", "-b"].includes(arg)))
    throw new Error("Use the Tauri CLI directly for custom bundles; desktop:build creates signed release artifacts");
  const cliArgs = release
    ? [...(targetIndex < 0 ? ["--target", target] : []), "--bundles", target.startsWith("universal") ? "app,dmg" : "nsis", ...args]
    : args;
  const result = spawnSync(process.execPath, [resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
    command, "--config", JSON.stringify(config), ...cliArgs], {
    cwd: root, stdio: "inherit", env: {
      ...env, TAURI_APP_PATH: resolve(root, "app"), TAURI_FRONTEND_PATH: root,
      VITE_DESKTOP_UPDATER_ENABLED: String(Boolean(config.plugins.updater.pubkey)),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  if (release) {
    const targetDir = resolve(root, env.CARGO_TARGET_DIR || "temp/cache/cargo");
    collectArtifacts(resolve(targetDir, target, "release/bundle"), desktopDist, target, version);
    writeManifest(desktopDist, version, env, false);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
