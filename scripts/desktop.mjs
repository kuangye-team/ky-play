import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initialize } from "./init-env.mjs";
import { desktopBundleResources, desktopDist, desktopEnv, releaseVersion, root, updaterConfig } from "./desktop-config.mjs";
import { collectArtifacts, writeManifest } from "./desktop-release.mjs";
import { rustCacheEnv } from "./rust.mjs";
import { prepareEmulatorJS } from "./prepare-emulatorjs.mjs";
import { writeAppOnlyHooks, writeEmulatorManifest } from "./desktop-emulator.mjs";

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
  const split = release && !env.VITE_EMULATOR_CDN_URL?.trim();
  let staging;
  let emulator;
  try {
    if (split) {
      await prepareEmulatorJS({ archiveUrl: env.EMULATORJS_ARCHIVE_URL });
      mkdirSync(resolve(root, "temp/artifacts"), { recursive: true });
      staging = mkdtempSync(resolve(root, "temp/artifacts/desktop-emulator-"));
      env.KY_PLAY_EMULATOR_MANIFEST = resolve(staging, "manifest.json");
      emulator = await writeEmulatorManifest(resolve(root, "ssg/public/emulatorjs"), env.KY_PLAY_EMULATOR_MANIFEST);
    } else delete env.KY_PLAY_EMULATOR_MANIFEST;
    const run = (command, config, args) => {
      const result = spawnSync(process.execPath, [resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
        command, "--config", JSON.stringify(config), ...args], {
        cwd: root, stdio: "inherit", env: {
          ...env, TAURI_APP_PATH: resolve(root, "app"), TAURI_FRONTEND_PATH: root,
          VITE_DESKTOP_UPDATER_ENABLED: String(Boolean(config.plugins.updater.pubkey)),
        },
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Tauri ${command} failed (${result.status})`);
    };
    if (release) {
      mkdirSync(desktopDist, { recursive: true });
      const prefix = `ky-play-${version}-${target.startsWith("universal") ? "universal" : "x64"}`;
      for (const name of readdirSync(desktopDist))
        if (name.startsWith(prefix) || name === "latest.json") rmSync(resolve(desktopDist, name));
    }
    run(command, config, cliArgs);
    if (release) {
      const bundle = resolve(env.CARGO_TARGET_DIR, target, "release/bundle");
      collectArtifacts(bundle, desktopDist, target, version);
      if (split) {
        // Reuse the compiled binary; re-bundle and sign without emulator files.
        // Start with clean bundle directories so no resources survive packaging.
        for (const dir of ["macos", "nsis"]) rmSync(resolve(bundle, dir), { recursive: true, force: true });
        const appConfig = { ...config, bundle: { ...config.bundle, resources: [] } };
        if (target === "x86_64-pc-windows-msvc") {
          const installerHooks = resolve(staging, "app-only-hooks.nsh");
          await writeAppOnlyHooks(installerHooks, emulator.hash);
          appConfig.bundle.windows = { nsis: { installerHooks } };
        }
        const featureIndex = args.findIndex((arg) => arg === "--features" || arg === "-f");
        run("bundle", appConfig, ["--target", target, "--bundles", target.startsWith("universal") ? "app" : "nsis",
          ...(args.includes("--ci") ? ["--ci"] : []),
          ...(featureIndex >= 0 ? ["--features", args[featureIndex + 1]] : [])]);
        collectArtifacts(bundle, desktopDist, target, version, "app");
        const arch = target.startsWith("universal") ? "universal" : "x64";
        writeFileSync(resolve(desktopDist, `ky-play-${version}-${arch}-emulator.json`),
          JSON.stringify({ schema: 1, version, hash: emulator.hash }) + "\n");
      }
      writeManifest(desktopDist, version, env, false);
    }
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
