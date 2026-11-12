import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { cloudflareEnv } from "./cloudflare-env";

const artifacts = fileURLToPath(new URL("../../temp/artifacts/", import.meta.url));
const directories: string[] = [];

function fixture(config: string) {
  mkdirSync(artifacts, { recursive: true });
  const root = mkdtempSync(join(artifacts, "cloudflare-env-"));
  directories.push(root);
  writeFileSync(join(root, "wrangler.jsonc"), config);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("builds with Wrangler vars without including dotenv or inherited process values", async () => {
  const root = fixture(`{
    // JSONC comments and trailing commas are supported.
    "vars": {
      "VITE_WEB_URL": "https://cloudflare.example.com/",
      "VITE_EMULATOR_CDN_URL": "https://cdn.example.com/4.2.3",
      "VITE_CLIENT_DOWNLOAD_URL": "",
      "VITE_NUMBER": 42,
      "VITE_FLAG": false,
      "VITE_NULL": null,
      "SERVER_ONLY": "private-value",
    },
  }`);
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"])
    writeFileSync(join(root, name), "VITE_WEB_URL=https://dotenv.invalid\nVITE_CLIENT_DOWNLOAD_URL=dotenv-download\nVITE_LOCAL_ONLY=dotenv-only\n");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VITE_WEB_URL", "https://inherited.invalid");
  vi.stubEnv("VITE_EMULATOR_CDN_URL", "https://inherited.invalid/4.2.3");
  vi.stubEnv("VITE_CLIENT_DOWNLOAD_URL", "inherited-download");
  vi.stubEnv("VITE_PROCESS_ONLY", "inherited-only");
  writeFileSync(join(root, "entry.js"), "globalThis.result = { ...import.meta.env, url: import.meta.env.VITE_WEB_URL };");
  const { env, config } = cloudflareEnv(root);
  expect(env.VITE_EMULATOR_CDN_URL).toBe("https://cdn.example.com/4.2.3");
  const result = await build({
    configFile: false,
    root,
    mode: "production",
    ...config,
    logLevel: "silent",
    build: { write: false, minify: false, lib: { entry: join(root, "entry.js"), formats: ["iife"], name: "Test" } },
  });
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!("output" in bundle)) throw new Error("Expected build output");
  const chunk = bundle.output.find((output) => output.type === "chunk");
  if (!chunk) throw new Error("Expected JavaScript output");
  const context: { result?: Record<string, unknown> } = {};
  runInNewContext(chunk.code, context);
  expect(context.result).toMatchObject({
    VITE_WEB_URL: "https://cloudflare.example.com/",
    url: "https://cloudflare.example.com/",
    VITE_EMULATOR_CDN_URL: "https://cdn.example.com/4.2.3",
    VITE_CLIENT_DOWNLOAD_URL: "",
    VITE_NUMBER: "42",
    VITE_FLAG: "false",
    VITE_NULL: "",
    PROD: true,
  });
  for (const key of ["SERVER_ONLY", "VITE_LOCAL_ONLY", "VITE_PROCESS_ONLY"])
    expect(context.result).not.toHaveProperty(key);
});

it.each(["{ broken", "[]", '{"vars":[]}', '{"vars":"invalid"}', '{"vars":{"VITE_WEB_URL":{}}}'])(
  "rejects invalid Wrangler configuration: %s", (config) => {
    expect(() => cloudflareEnv(fixture(config))).toThrow("ssg/wrangler.jsonc");
  },
);
