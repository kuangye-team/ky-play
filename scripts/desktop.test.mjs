import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, verify } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectArtifacts, writeManifest } from "./desktop-release.mjs";
import { desktopBundleResources, releaseVersion, root, signPathEnabled, updaterConfig } from "./desktop-config.mjs";
import { finalizeWindowsSigning } from "./finalize-windows-signing.mjs";

const signature = Buffer.from("untrusted comment: test signature\nfixture").toString("base64");
function fixture(t) {
  mkdirSync("temp/artifacts", { recursive: true });
  const directory = mkdtempSync(resolve("temp/artifacts/desktop-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test("desktop bundles one shared emulator directory unless a CDN is selected", () => {
  const resources = { "../ssg/public/emulatorjs/": "emulatorjs/" };
  assert.deepEqual(desktopBundleResources({}), resources);
  assert.deepEqual(desktopBundleResources({ VITE_EMULATOR_CDN_URL: "  " }), resources);
  assert.deepEqual(desktopBundleResources({ VITE_EMULATOR_CDN_URL: "https://example.com/4.2.3" }), []);
});
test("release configuration requires signing and an HTTPS updater URL", () => {
  assert.equal(releaseVersion("v1.2.3"), "1.2.3");
  for (const value of ["main", "v1.2", "1.2.3-beta", "01.2.3", "1.0.0/../../x"]) assert.throws(() => releaseVersion(value));
  assert.throws(() => updaterConfig({}, true), /require/);
  const env = { TAURI_UPDATER_URL: "https://updates.example.com/latest.json", TAURI_UPDATER_PUBLIC_KEY: "public", TAURI_SIGNING_PRIVATE_KEY: "private" };
  assert.equal(updaterConfig(env, true).bundle.createUpdaterArtifacts, true);
  assert.throws(() => updaterConfig({ ...env, TAURI_UPDATER_URL: "http://example.com/latest.json" }, true), /HTTPS/);
  assert.deepEqual(updaterConfig({}, false).plugins.updater.endpoints, []);
});
test("SignPath is opt-in and rejects incomplete configuration when enabled", () => {
  assert.equal(signPathEnabled({}), false);
  assert.equal(signPathEnabled({ SIGNPATH_ENABLED: "false", SIGNPATH_API_TOKEN: "token" }), false);
  assert.equal(signPathEnabled({ SIGNPATH_API_TOKEN: "token" }), false);
  assert.throws(() => signPathEnabled({ SIGNPATH_ENABLED: "yes" }), /true or false/);
  const env = { SIGNPATH_ENABLED: "true", SIGNPATH_API_TOKEN: "token",
    SIGNPATH_ORGANIZATION_ID: "organization", SIGNPATH_PROJECT_SLUG: "project", SIGNPATH_SIGNING_POLICY_SLUG: "release" };
  assert.equal(signPathEnabled(env), true);
  for (const key of Object.keys(env).filter((key) => key !== "SIGNPATH_ENABLED"))
    assert.throws(() => signPathEnabled({ ...env, [key]: " " }), new RegExp(key));
});
test("SignPath installer receives a matching updater signature and manifest", (t) => {
  const dir = fixture(t);
  const signed = resolve(dir, "signed"); const out = resolve(dir, "dist");
  mkdirSync(signed); mkdirSync(out);
  const keyPath = resolve(dir, "updater.key");
  const generated = spawnSync(process.execPath, [resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
    "signer", "generate", "--ci", "--password", "", "--write-keys", keyPath], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const name = "ky-play-1.2.3-x64-setup.exe";
  const before = Buffer.from("original installer bytes");
  const after = Buffer.from("installer bytes changed by Authenticode signing");
  writeFileSync(resolve(out, name), before);
  writeFileSync(resolve(out, `${name}.sig`), signature);
  writeFileSync(resolve(signed, name), after);
  writeFileSync(resolve(signed, `${name}.sig`), signature);
  finalizeWindowsSigning(signed, out, "v1.2.3", { ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: keyPath, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
    TAURI_RELEASE_BASE_URL: "https://updates.example.com/v1.2.3" });
  assert.deepEqual(readFileSync(resolve(out, name)), after);
  const newSignature = readFileSync(resolve(out, `${name}.sig`), "utf8").trim();
  const manifest = JSON.parse(readFileSync(resolve(out, "latest.json")));
  assert.equal(manifest.platforms["windows-x86_64"].signature, newSignature);
  assert.equal(manifest.platforms["windows-x86_64"].url, `https://updates.example.com/v1.2.3/${name}`);
  // Verify the real Minisign signature independently with Node's Ed25519 API.
  const publicLines = Buffer.from(readFileSync(`${keyPath}.pub`, "utf8").trim(), "base64").toString().split("\n");
  const publicKey = Buffer.from(publicLines[1], "base64").subarray(10);
  const key = { key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]), format: "der", type: "spki" };
  const lines = Buffer.from(newSignature, "base64").toString().split("\n");
  const packet = Buffer.from(lines[1], "base64");
  assert.equal(packet.subarray(0, 2).toString(), "ED");
  const fileSignature = packet.subarray(10);
  const matches = (bytes) => verify(null, createHash("blake2b512").update(bytes).digest(), key, fileSignature);
  assert.equal(matches(after), true);
  assert.equal(matches(before), false);
  const trustedComment = lines[2].replace(/^trusted comment: /, "");
  assert.match(trustedComment, /1\.2\.3/);
  assert.equal(verify(null, Buffer.concat([fileSignature, Buffer.from(trustedComment)]), key, Buffer.from(lines[3], "base64")), true);
});
test("missing or unusable SignPath output cannot replace release artifacts", (t) => {
  const dir = fixture(t);
  const signed = resolve(dir, "signed"); const out = resolve(dir, "dist");
  mkdirSync(signed); mkdirSync(out);
  const name = "ky-play-1.2.3-x64-setup.exe";
  writeFileSync(resolve(out, name), "original");
  writeFileSync(resolve(out, `${name}.sig`), signature);
  writeFileSync(resolve(out, "latest.json"), "original manifest");
  writeFileSync(resolve(signed, "ky-play-1.0.0-x64-setup.exe"), "wrong version");
  assert.throws(() => finalizeWindowsSigning(signed, out, "1.2.3", {}), /Missing or empty/);
  writeFileSync(resolve(signed, name), "");
  assert.throws(() => finalizeWindowsSigning(signed, out, "1.2.3", {}), /Missing or empty/);
  writeFileSync(resolve(signed, name), "signed installer");
  assert.throws(() => finalizeWindowsSigning(signed, out, "1.2.3", {}), /PRIVATE_KEY is required/);
  assert.throws(() => finalizeWindowsSigning(signed, out, "1.2.3", { ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: "invalid-private-key" }), /Failed to sign/);
  assert.equal(readFileSync(resolve(out, name), "utf8"), "original");
  assert.equal(readFileSync(resolve(out, `${name}.sig`), "utf8"), signature);
  assert.equal(readFileSync(resolve(out, "latest.json"), "utf8"), "original manifest");
});
test("collect installers with stable names and merge universal macOS + Windows metadata", (t) => {
  const dir = fixture(t);
  const mac = resolve(dir, "mac"); const win = resolve(dir, "win"); const out = resolve(dir, "dist");
  mkdirSync(resolve(mac, "dmg"), { recursive: true });
  mkdirSync(resolve(mac, "macos"));
  mkdirSync(resolve(win, "nsis"), { recursive: true });
  writeFileSync(resolve(mac, "dmg/Ky Play_1.2.3_universal.dmg"), "dmg");
  writeFileSync(resolve(mac, "macos/Ky Play.app.tar.gz"), "app");
  writeFileSync(resolve(mac, "macos/Ky Play.app.tar.gz.sig"), signature);
  writeFileSync(resolve(win, "nsis/Ky Play_1.2.3_x64-setup.exe"), "exe");
  writeFileSync(resolve(win, "nsis/Ky Play_1.2.3_x64-setup.exe.sig"), signature);
  // Renaming the app or rebuilding a different version leaves old bundles.
  for (const name of ["ky-play", "拾光 · Oasis", "Ky Play"]) {
    for (const version of ["1.0.0", "1.2.3"]) {
      if (name === "Ky Play" && version === "1.2.3") continue;
      writeFileSync(resolve(mac, `dmg/${name}_${version}_universal.dmg`), "old dmg");
      writeFileSync(resolve(win, `nsis/${name}_${version}_x64-setup.exe`), "old exe");
      writeFileSync(resolve(win, `nsis/${name}_${version}_x64-setup.exe.sig`), "old signature");
    }
  }
  writeFileSync(resolve(mac, "macos/ky-play.app.tar.gz"), "old app");
  writeFileSync(resolve(mac, "macos/ky-play.app.tar.gz.sig"), "old signature");
  collectArtifacts(mac, out, "universal-apple-darwin", "1.2.3");
  assert.throws(() => writeManifest(out, "1.2.3", {}), /Missing update artifact/);
  collectArtifacts(win, out, "x86_64-pc-windows-msvc", "1.2.3");
  assert.equal(readFileSync(resolve(out, "ky-play-1.2.3-universal.dmg"), "utf8"), "dmg");
  assert.equal(readFileSync(resolve(out, "ky-play-1.2.3-universal.app.tar.gz"), "utf8"), "app");
  assert.equal(readFileSync(resolve(out, "ky-play-1.2.3-universal.app.tar.gz.sig"), "utf8"), signature);
  assert.equal(readFileSync(resolve(out, "ky-play-1.2.3-x64-setup.exe"), "utf8"), "exe");
  const manifest = writeManifest(out, "v1.2.3", { GITHUB_REPOSITORY: "owner/fork" });
  assert.equal(manifest.version, "1.2.3");
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]);
  assert.deepEqual(manifest.platforms["darwin-aarch64"], manifest.platforms["darwin-x86_64"]);
  assert.match(manifest.platforms["darwin-aarch64"].url, /owner\/fork\/releases\/download\/v1.2.3\/ky-play-1.2.3-universal.app.tar.gz$/);
  assert.match(manifest.platforms["windows-x86_64"].url, /ky-play-1.2.3-x64-setup.exe$/);
  assert.equal(manifest.platforms["windows-x86_64"].signature, signature);
  assert.deepEqual(JSON.parse(readFileSync(resolve(out, "latest.json"))), manifest);
  assert.match(writeManifest(out, "1.2.3", { TAURI_RELEASE_BASE_URL: "https://cdn.example.com/apps/" }).platforms["windows-x86_64"].url, /^https:\/\/cdn.example.com\/apps\/ky-play/);
  writeFileSync(resolve(out, "ky-play-1.2.3-x64-setup.exe.sig"), "");
  assert.throws(() => writeManifest(out, "1.2.3", {}), /Invalid updater signature/);
});
test("missing current app artifacts fail before copying instead of using old bundles", (t) => {
  const dir = fixture(t);
  const bundle = resolve(dir, "bundle"); const out = resolve(dir, "dist");
  mkdirSync(resolve(bundle, "dmg"), { recursive: true });
  mkdirSync(resolve(bundle, "macos"));
  writeFileSync(resolve(bundle, "dmg/Ky Play_1.2.3_universal.dmg"), "dmg");
  writeFileSync(resolve(bundle, "macos/ky-play.app.tar.gz"), "old app");
  writeFileSync(resolve(bundle, "macos/ky-play.app.tar.gz.sig"), signature);
  assert.throws(() => collectArtifacts(bundle, out, "universal-apple-darwin", "1.2.3"),
    /Missing release artifact: .*Ky Play\.app\.tar\.gz$/);
  assert.equal(existsSync(out), false);
  writeFileSync(resolve(bundle, "macos/Ky Play.app.tar.gz"), "app");
  assert.throws(() => collectArtifacts(bundle, out, "universal-apple-darwin", "1.2.3"),
    /Missing release artifact: .*Ky Play\.app\.tar\.gz\.sig$/);
  assert.equal(existsSync(out), false);
});
