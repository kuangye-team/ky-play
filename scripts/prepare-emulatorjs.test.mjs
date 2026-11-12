import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { path7za } from "7zip-bin";
import { prepareEmulatorJS } from "./prepare-emulatorjs.mjs";
import { initialize } from "./init-env.mjs";

async function fixture(t) {
  await mkdir("temp/artifacts", { recursive: true });
  const root = await mkdtemp(resolve("temp/artifacts/prepare-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = resolve(root, "source");
  for (const path of ["data/version.json", "data/loader.js", "data/emulator.min.js", "data/emulator.min.css", "data/cores/fceumm-wasm.data", "data/localization/zh-CN.json"]) {
    await mkdir(dirname(resolve(source, path)), { recursive: true });
    await writeFile(resolve(source, path), path.endsWith("version.json") ? '{"version":"4.2.3"}' : "fixture");
    if (process.platform !== "win32") {
      await chmod(dirname(resolve(source, path)), 0o700);
      await chmod(resolve(source, path), 0o600);
    }
  }
  const archive = resolve(root, "release.7z");
  if (process.platform !== "win32") await chmod(path7za, 0o755);
  const result = spawnSync(path7za, ["a", archive, "data"], { cwd: source, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const bytes = await readFile(archive);
  await mkdir(resolve(root, "ssg/licenses"), { recursive: true });
  await writeFile(resolve(root, "ssg/licenses/emulatorjs.json"), JSON.stringify({
    version: "4.2.3", archiveUrl: pathToFileURL(archive).href,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  return { root, archive, bytes };
}

test("fresh and cached resources are readable by a separate static-server user", { skip: process.platform === "win32" }, async (t) => {
  const { root } = await fixture(t);
  const output = resolve(root, "ssg/public/emulatorjs");
  const modes = [
    ["", 0o755], ["data", 0o755], ["data/cores", 0o755], ["data/localization", 0o755],
    ["data/loader.js", 0o644], ["data/cores/fceumm-wasm.data", 0o644],
  ];
  await prepareEmulatorJS({ root });
  for (const [path, mode] of modes)
    assert.equal((await stat(resolve(output, path))).mode & 0o777, mode, path || "release root");
  const loaderTime = (await stat(resolve(output, "data/loader.js"))).mtimeMs;
  for (const [path, mode] of modes) await chmod(resolve(output, path), mode & 0o700);
  await prepareEmulatorJS({ root });
  for (const [path, mode] of modes)
    assert.equal((await stat(resolve(output, path))).mode & 0o777, mode, path || "release root");
  assert.equal((await stat(resolve(output, "data/loader.js"))).mtimeMs, loaderTime);
});

test("download, reuse prepared files, and repair missing resources from the verified cache", async (t) => {
  const { root, bytes } = await fixture(t);
  let downloads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/release") {
      response.writeHead(302, { Location: "/4.2.3.7z" });
      return response.end();
    }
    downloads++;
    response.end(bytes);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const archiveUrl = `http://127.0.0.1:${server.address().port}/release`;
  await prepareEmulatorJS({ root, archiveUrl });
  const loader = resolve(root, "ssg/public/emulatorjs/data/loader.js");
  const originalTime = (await stat(loader)).mtimeMs;
  assert.equal(await readFile(loader, "utf8"), "fixture");
  assert.equal(downloads, 1);
  assert.deepEqual(await readFile(resolve(root, "temp/cache/emulatorjs/4.2.3.7z")), bytes);
  await prepareEmulatorJS({ root, archiveUrl });
  assert.equal((await stat(loader)).mtimeMs, originalTime);
  assert.equal(downloads, 1);
  await rm(loader);
  await prepareEmulatorJS({ root, archiveUrl });
  assert.equal(await readFile(loader, "utf8"), "fixture");
  assert.equal(downloads, 1);
  await writeFile(loader, "truncated");
  await writeFile(resolve(root, "temp/cache/emulatorjs/4.2.3.7z"), "corrupt cache");
  await prepareEmulatorJS({ root, archiveUrl });
  assert.equal(downloads, 2);
  assert.equal(await readFile(loader, "utf8"), "fixture");
  assert.deepEqual((await readdir(resolve(root, "temp/cache/emulatorjs"))).sort(), ["4.2.3.7z", "4.2.3.prepared.json"]);
});

test("archive URL from .env is honored and checksum failures preserve existing output", async (t) => {
  const { root, archive } = await fixture(t);
  await writeFile(resolve(root, ".env"), `EMULATORJS_ARCHIVE_URL=${pathToFileURL(archive).href}\n`);
  await prepareEmulatorJS({ root });
  const output = resolve(root, "ssg/public/emulatorjs");
  await writeFile(resolve(output, "keep.txt"), "keep existing files until extraction succeeds");
  await rm(resolve(root, "temp/cache/emulatorjs/4.2.3.prepared.json"));
  await rm(resolve(root, "temp/cache/emulatorjs/4.2.3.7z"));
  const invalid = resolve(root, "invalid.7z");
  await writeFile(invalid, "invalid archive");
  await assert.rejects(prepareEmulatorJS({ root, archiveUrl: pathToFileURL(invalid).href }), /SHA-256/);
  assert.equal(await readFile(resolve(output, "data/loader.js"), "utf8"), "fixture");
  assert.match(await readFile(resolve(output, "keep.txt"), "utf8"), /keep existing/);
  assert.deepEqual(await readdir(resolve(root, "temp/cache/emulatorjs")), []);
});

test("initialization keeps environment settings separate and writes Cloudflare variables into vars", async (t) => {
  const { root } = await fixture(t);
  await mkdir(resolve(root, "app"), { recursive: true });
  for (const file of [".env.example", ".env.json.example", "app/.env.example", "ssg/.env.example", "ssg/wrangler.jsonc.example"])
    await copyFile(file, resolve(root, file));
  initialize(root);
  const config = JSON.parse(await readFile(resolve(root, ".env.json"), "utf8"));
  config.prepare.EMULATORJS_ARCHIVE_URL = "https://mirror.example.com/4.2.3.7z";
  config.wrangler.ssg.vars = { VITE_WEB_URL: "https://cloudflare.example.com/" };
  for (const mode of ["local", "production", "compose", "desktop"]) {
    const settings = mode === "desktop" ? config.desktop : config[mode].ssg;
    settings.VITE_API_LATEST = `https://updates.example.com/${mode}/latest`;
  }
  await writeFile(resolve(root, ".env.json"), JSON.stringify(config));
  initialize(root);
  assert.match(await readFile(resolve(root, ".env"), "utf8"), /EMULATORJS_ARCHIVE_URL=https:\/\/mirror.example.com\/4.2.3.7z/);
  for (const mode of ["local", "production", "compose", "desktop"]) {
    const env = parseEnv(await readFile(resolve(root, `ssg/.env.${mode}`), "utf8"));
    const settings = mode === "desktop" ? config.desktop : config[mode].ssg;
    assert.equal(env.VITE_API_LATEST, settings.VITE_API_LATEST);
    assert.equal(env.VITE_WEB_URL, settings.VITE_WEB_URL);
    assert.equal(env.VITE_CLIENT_DOWNLOAD_URL, settings.VITE_CLIENT_DOWNLOAD_URL);
    assert.equal(env.VITE_EMULATOR_CDN_URL, settings.VITE_EMULATOR_CDN_URL);
    assert.equal(env.CARGO_TARGET_DIR, undefined);
  }
  assert.equal(parseEnv(await readFile(resolve(root, ".env"), "utf8")).VITE_API_LATEST, config.compose.ssg.VITE_API_LATEST);
  assert.equal(parseEnv(await readFile(resolve(root, "app/.env"), "utf8")).CARGO_TARGET_DIR, "temp/cache/cargo");
  for (const file of ["ssg/.env.local", "ssg/.env.production", "ssg/.env.desktop", "ssg/.env.compose", "app/.env"]) {
    const env = await readFile(resolve(root, file), "utf8");
    assert.doesNotMatch(env, /EMULATORJS_ARCHIVE_URL/);
  }
  const wrangler = JSON.parse(await readFile(resolve(root, "ssg/wrangler.jsonc"), "utf8"));
  assert.equal(wrangler.build.command, "npm run build:deploy");
  assert.equal(wrangler.vars.VITE_WEB_URL, "https://cloudflare.example.com/");
  assert.equal(wrangler.vars.VITE_EMULATOR_CDN_URL, "https://cdn.emulatorjs.org/4.2.3");
  assert.equal(wrangler.vars.VITE_API_LATEST, "https://github.com/kuangye-team/ky-play/releases/latest/download/latest.json");

  config.wrangler.ssg = {
    name: "custom-worker",
    assets: { directory: "./custom-dist" },
    VITE_WEB_URL: "https://flat.example.com/",
    VITE_EMULATOR_CDN_URL: "",
    VITE_CUSTOM: "custom-value",
  };
  for (const nested of [false, true]) {
    if (nested) config.wrangler.ssg.vars = { VITE_WEB_URL: "https://nested.example.com/" };
    await writeFile(resolve(root, ".env.json"), JSON.stringify(config));
    initialize(root);
    const actual = JSON.parse(await readFile(resolve(root, "ssg/wrangler.jsonc"), "utf8"));
    assert.equal(actual.name, "custom-worker");
    assert.equal(actual.assets.directory, "./custom-dist");
    assert.equal(actual.assets.not_found_handling, wrangler.assets.not_found_handling);
    assert.deepEqual(actual.build, wrangler.build);
    assert.deepEqual(actual.vars, {
      ...wrangler.vars,
      VITE_WEB_URL: nested ? "https://nested.example.com/" : "https://flat.example.com/",
      VITE_EMULATOR_CDN_URL: "",
      VITE_CUSTOM: "custom-value",
    });
    assert.ok(Object.keys(actual).every((key) => !key.startsWith("VITE_")));
  }
});
