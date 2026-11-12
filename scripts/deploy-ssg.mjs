import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await mkdir(resolve(root, "temp/artifacts"), { recursive: true });
const temporary = await mkdtemp(resolve(root, "temp/artifacts/wrangler-"));
try {
  // Let Vite read production settings. Wrangler otherwise exports .env.local
  // into the build process and even replaces explicit empty process values.
  const envFile = resolve(temporary, ".env");
  await writeFile(envFile, "");
  const result = spawnSync(process.execPath, [
    resolve(root, "ssg/node_modules/wrangler/bin/wrangler.js"),
    "deploy", "--env-file", envFile, ...process.argv.slice(2),
  ], { cwd: resolve(root, "ssg"), stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
