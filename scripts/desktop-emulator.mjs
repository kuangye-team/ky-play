import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Hash the actual packaged files, including local changes, independently of
// extraction timestamps, filesystem order, and the build machine's OS.
export async function emulatorManifest(directory) {
  const paths = [];
  async function walk(prefix = "") {
    for (const entry of await readdir(resolve(directory, prefix), { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.name.includes("\\") || entry.name.includes(":")) throw new Error(`Invalid emulator path: ${path}`);
      if (entry.isDirectory()) await walk(`${path}/`);
      else if (entry.isFile()) paths.push(path);
      else throw new Error(`Unsupported emulator entry: ${path}`);
    }
  }
  await walk();
  if (!paths.includes("data/loader.js")) throw new Error("Missing EmulatorJS data/loader.js");
  const files = [];
  for (const path of paths.sort()) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(resolve(directory, path))) hash.update(chunk);
    files.push({ path, size: (await stat(resolve(directory, path))).size, sha256: hash.digest("hex") });
  }
  return { schema: 1, hash: createHash("sha256").update(JSON.stringify(files)).digest("hex"), files };
}

export async function writeEmulatorManifest(directory, output) {
  const manifest = await emulatorManifest(directory);
  await writeFile(output, JSON.stringify(manifest));
  return manifest;
}

export async function writeAppOnlyHooks(output, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid emulator hash");
  const hooks = await readFile(new URL("../app/windows/installer-hooks.nsh", import.meta.url), "utf8");
  await writeFile(output, `!define KY_PLAY_APP_ONLY_HASH "${hash}"\n${hooks}`);
}
