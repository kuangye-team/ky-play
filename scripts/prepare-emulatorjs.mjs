import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repository = fileURLToPath(new URL("..", import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));

async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(resolve(directory, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await inventory(directory, path + "/"));
    else if (entry.isFile()) files.push({ path, size: (await stat(resolve(directory, path))).size });
    else throw new Error(`Unexpected EmulatorJS archive entry: ${path}`);
  }
  return files;
}

async function makePublicReadable(directory) {
  if (process.platform === "win32") return;
  // mkdtemp and extracted directories can be owner-only. Static servers such
  // as Nginx read these files as a different user after the build is copied.
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await makePublicReadable(path);
    else if (entry.isFile()) await chmod(path, 0o644);
    else throw new Error(`Unexpected EmulatorJS archive entry: ${path}`);
  }
}

async function prepared(output, record, release) {
  try {
    const saved = await json(record);
    if (saved.sha256 !== release.archiveSha256 || !saved.files?.length) return false;
    for (const file of saved.files) {
      const current = await stat(resolve(output, file.path));
      if (!current.isFile() || current.size !== file.size) return false;
    }
    return true;
  } catch { return false; }
}

async function download(url, target) {
  const source = new URL(url);
  if (source.protocol === "file:") return copyFile(fileURLToPath(source), target);
  if (!["http:", "https:"].includes(source.protocol))
    throw new Error("EMULATORJS_ARCHIVE_URL must be an HTTP(S) or file URL.");
  const { default: redirects } = await import("follow-redirects");
  await new Promise((done, reject) => {
    const request = redirects[source.protocol.slice(0, -1)].get(source, {
      maxRedirects: 10, signal: AbortSignal.timeout(10 * 60_000),
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`EmulatorJS download failed: HTTP ${response.statusCode}`));
        return;
      }
      pipeline(response, createWriteStream(target)).then(done, reject);
    });
    request.once("error", reject);
  });
}

async function extract(archive, output) {
  const { path7za } = await import("7zip-bin");
  // npm may strip executable permissions from the packaged Unix binary.
  if (process.platform !== "win32" && isAbsolute(path7za)) await chmod(path7za, 0o755);
  await new Promise((done, reject) => {
    const child = spawn(path7za, ["x", "-y", `-o${output}`, archive], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done() : reject(new Error(`7-Zip exited with code ${code}`)));
  });
}

export async function prepareEmulatorJS({ root = repository, archiveUrl } = {}) {
  const release = await json(resolve(root, "ssg/licenses/emulatorjs.json"));
  let env = {};
  try { env = parseEnv(await readFile(resolve(root, ".env"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const url = (archiveUrl ?? process.env.EMULATORJS_ARCHIVE_URL ?? env.EMULATORJS_ARCHIVE_URL) || release.archiveUrl;
  const cache = resolve(root, "temp/cache/emulatorjs");
  const archive = resolve(cache, `${release.version}.7z`);
  const record = resolve(cache, `${release.version}.prepared.json`);
  const output = resolve(root, "ssg/public/emulatorjs");
  if (await prepared(output, record, release)) {
    await makePublicReadable(output);
    console.log(`EmulatorJS ${release.version} is ready.`);
    return;
  }
  await mkdir(cache, { recursive: true });
  if (await checksum(archive).catch(() => "") !== release.archiveSha256) {
    const partial = `${archive}.part`;
    console.log(`Downloading EmulatorJS ${release.version}…`);
    try {
      await download(url, partial);
      if (await checksum(partial) !== release.archiveSha256)
        throw new Error(`EmulatorJS ${release.version} archive SHA-256 does not match the official release.`);
      await rm(archive, { force: true });
      await rename(partial, archive);
    } finally { await rm(partial, { force: true }); }
  }
  // Extract outside the download cache mount so rename stays on the output filesystem.
  const artifacts = resolve(root, "temp/artifacts");
  await mkdir(artifacts, { recursive: true });
  const staging = await mkdtemp(resolve(artifacts, "emulatorjs-"));
  try {
    await extract(archive, staging);
    // Release archives may wrap the files in a version directory.
    const source = await stat(resolve(staging, "data")).then(() => staging, () => resolve(staging, release.version));
    const version = await json(resolve(source, "data/version.json"));
    if (version.version !== release.version) throw new Error(`Expected EmulatorJS ${release.version}, got ${version.version}`);
    const files = await inventory(source);
    for (const required of ["data/loader.js", "data/emulator.min.js", "data/emulator.min.css", "data/cores/fceumm-wasm.data", "data/localization/zh-CN.json"])
      if (!files.some((file) => file.path === required && file.size > 0)) throw new Error(`Missing EmulatorJS file: ${required}`);
    await makePublicReadable(source);
    await mkdir(resolve(root, "ssg/public"), { recursive: true });
    await rm(output, { recursive: true, force: true });
    await rename(source, output);
    await writeFile(record, JSON.stringify({ sha256: release.archiveSha256, files }, null, 2) + "\n");
    console.log(`Prepared EmulatorJS ${release.version} in ssg/public/emulatorjs.`);
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareEmulatorJS();
}
