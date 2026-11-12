import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../ssg/", import.meta.url));
const output = resolve(root, "public/licenses");
const entries = [];
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

async function add(entry, text) {
  if (!text.trim()) throw new Error(`Missing license text: ${entry.name}`);
  entries.push({ ...entry, text });
}

for (const game of await json(resolve(root, "licenses/games/bundled.json"))) {
  const rom = await readFile(resolve(root, `public${game.romUrl}`));
  const digest = createHash("sha256").update(rom).digest("hex");
  if (digest !== game.sha256 || rom.length !== game.size)
    throw new Error(`Refresh ${game.englishName}'s license record before distributing ${game.romUrl}`);
  await add(
    {
      id: game.id,
      name: game.name,
      version: game.version,
      license: game.license,
      group: "game",
      projectUrl: game.projectUrl,
      sourceUrl: game.sourceUrl,
      downloadUrl: game.downloadUrl,
      note: game.note,
    },
    [
      `${game.englishName} / ${game.name} ${game.version}\nBy ${game.author} and contributors. Copyright notices and credits remain intact in the game and source.\nUnmodified ROM: ${game.downloadUrl}\nROM SHA-256: ${game.sha256}\nCorresponding source: ${game.sourceUrl}\nLicense: ${game.license}\nLicense snapshot: ${game.licenseSourceUrl}`,
      await readFile(resolve(root, `licenses/games/${game.id}.txt`), "utf8"),
    ].join("\n\n"),
  );
}

const emulator = await json(resolve(root, "licenses/emulatorjs.json"));
const emulatorLicense = await readFile(resolve(root, "licenses/emulatorjs.txt"));
if (createHash("sha256").update(emulatorLicense).digest("hex") !== emulator.licenseSha256)
  throw new Error("EmulatorJS license snapshot does not match its recorded checksum.");
await add(
  {
    id: "emulatorjs",
    name: "EmulatorJS",
    version: emulator.version,
    license: "GPL-3.0（详见原文）",
    group: "emulator",
    projectUrl: "https://github.com/EmulatorJS/EmulatorJS",
  },
  emulatorLicense.toString("utf8"),
);
await add(
  {
    id: "retroarch",
    name: "RetroArch",
    version: "随模拟器提供",
    license: "GPL-3.0（详见原文）",
    group: "emulator",
    projectUrl: "https://github.com/EmulatorJS/RetroArch",
  },
  await readFile(resolve(root, "licenses/retroarch.txt"), "utf8"),
);

for (const core of await json(resolve(root, "licenses/cores.json"))) {
  await add(
    {
      id: core.id,
      name: core.name,
      version: core.version,
      license: core.license,
      projectUrl: core.projectUrl,
      group: "core",
      note: core.note,
    },
    await readFile(resolve(root, `licenses/cores/${core.id}.txt`), "utf8"),
  );
}

// Include the frontend's runtime dependency tree, including nested package versions.
const visited = new Set();
async function collect(name, parent) {
  const require = createRequire(parent);
  let directory;
  try {
    directory = dirname(require.resolve(`${name}/package.json`));
  } catch {
    directory = dirname(require.resolve(name));
  }
  let pkg;
  while (true) {
    try {
      pkg = await json(resolve(directory, "package.json"));
      if (pkg.name === name) break;
    } catch {
      /* Walk up from packages that hide package.json in their exports. */
    }
    const next = dirname(directory);
    if (next === directory) throw new Error(`Cannot locate package ${name}`);
    directory = next;
  }
  const key = `${pkg.name}@${pkg.version}`;
  if (visited.has(key)) return;
  visited.add(key);
  const files = (await readdir(directory))
    .filter((file) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(file))
    .sort();
  // This package declares MIT but omits LICENSE. See licenses/web/sources.json
  // for the upstream license snapshot; this is not a source-version assertion.
  const fallback =
    key === "react-remove-scroll-bar@2.3.8"
      ? resolve(root, "licenses/web/react-remove-scroll-bar-2.3.8.txt")
      : null;
  if (!files.length && !fallback)
    throw new Error(`Missing runtime dependency license: ${key}`);
  const text = files.length
    ? (
        await Promise.all(
          files.map(
            async (file) =>
              `${file}\n\n${await readFile(resolve(directory, file), "utf8")}`,
          ),
        )
      ).join("\n\n")
    : await readFile(fallback, "utf8");
  const repo =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const url = repo
    ?.replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
  await add(
    {
      id: key.replace(/[^a-zA-Z0-9._-]/g, "-"),
      name: pkg.name,
      version: pkg.version,
      license: pkg.license || "见许可原文",
      group: "web",
      projectUrl: url?.startsWith("https://")
        ? url
        : `https://www.npmjs.com/package/${pkg.name}`,
    },
    text,
  );
  for (const dependency of Object.keys(pkg.dependencies || {}).sort())
    await collect(dependency, resolve(directory, "package.json"));
}
const app = await json(resolve(root, "package.json"));
for (const name of Object.keys(app.dependencies).sort())
  await collect(name, resolve(root, "package.json"));
// These build-time dependencies also ship code in the page and generated worker.
for (const name of [
  "workbox-window", "workbox-precaching", "workbox-cacheable-response", "workbox-expiration",
])
  await collect(name, resolve(root, "package.json"));
const pwa = await json(resolve(root, "node_modules/vite-plugin-pwa/package.json"));
await add({
  id: "vite-plugin-pwa", name: pwa.name, version: pwa.version,
  license: pwa.license, group: "web", projectUrl: "https://github.com/vite-pwa/vite-plugin-pwa",
}, await readFile(resolve(root, "node_modules/vite-plugin-pwa/LICENSE"), "utf8"));

await writeFile(
  resolve(output, "index.json"),
  JSON.stringify({ entries }) + "\n",
);
console.log(`Prepared license notices for ${entries.length} third-party components.`);
