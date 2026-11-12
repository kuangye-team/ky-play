#!/usr/bin/env node
// Generate development, production, Docker and Cloudflare configuration.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envKey = /^[A-Za-z_][A-Za-z0-9_]*$/;
const devOnly = new Set(["WEB_PORT"]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function section(config, path) {
  let value = config;
  for (const key of path.split(".")) {
    value = Object.hasOwn(value, key) ? value[key] : {};
    if (!isObject(value)) throw new Error(`${path} 必须是对象`);
  }
  return value;
}

function envValue(value) {
  if (value === null) return "";
  if (!["string", "number", "boolean"].includes(typeof value))
    throw new Error("环境变量只能使用字符串、数字或布尔值");
  const text = String(value);
  if (!text || /^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  if (/['\r\n]/.test(text)) throw new Error("环境变量不能包含单引号或换行");
  return `'${text}'`;
}

export function renderEnv(template, overrides, excluded = new Set()) {
  for (const [key, value] of Object.entries(overrides)) {
    if (!envKey.test(key)) throw new Error(`无效的环境变量名：${key}`);
    envValue(value);
  }
  const remaining = new Map(Object.entries(overrides));
  const lines = template.split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  for (let index = 0; index < lines.length; index++) {
    const key = lines[index].split("=", 1)[0];
    if (lines[index].includes("=") && envKey.test(key) && remaining.has(key)) {
      lines[index] = `${key}=${envValue(remaining.get(key))}`;
      remaining.delete(key);
    }
  }
  for (const [key, value] of remaining) {
    if (!envKey.test(key)) throw new Error(`无效的环境变量名：${key}`);
    lines.push(`${key}=${envValue(value)}`);
  }
  return lines.filter((line) => !excluded.has(line.split("=", 1)[0])).join("\n") + "\n";
}

function merge(base, overrides) {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [
      key,
      isObject(base[key]) && isObject(value) ? merge(base[key], value) : value,
    ])),
  };
}

export function initialize(directory = root) {
  const read = (name) => readFileSync(resolve(directory, name), "utf8");
  const configPath = resolve(directory, ".env.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, read(".env.json.example"), { mode: 0o600 });
    console.log("generated .env.json（后续配置请修改此文件）");
  }
  const config = JSON.parse(read(".env.json"));
  if (!isObject(config)) throw new Error(".env.json 顶层必须是对象");

  // Validate all content before replacing any generated configuration.
  const outputs = new Map();
  outputs.set("app/.env", renderEnv(read("app/.env.example"), section(config, "desktop")));
  outputs.set("ssg/.env.desktop", renderEnv(read("ssg/.env.example"),
    Object.fromEntries(Object.entries(section(config, "desktop")).filter(([key]) => key.startsWith("VITE_"))), devOnly));
  // Compose interpolates build.args from the root .env. Keep their source in compose.ssg.
  outputs.set(".env", renderEnv(read(".env.example"), {
    ...section(config, "prepare"),
    ...section(config, "compose.root"),
    ...section(config, "compose.ssg"),
  }, devOnly));
  for (const mode of ["local", "production", "compose"]) {
    outputs.set(`ssg/.env.${mode}`, renderEnv(
      read("ssg/.env.example"), section(config, `${mode}.ssg`),
      mode === "local" ? new Set() : devOnly,
    ));
  }
  // The checked-in JSONC template uses the JSON subset.
  const wrangler = merge(JSON.parse(read("ssg/wrangler.jsonc.example")), section(config, "wrangler.ssg"));
  outputs.set("ssg/wrangler.jsonc", JSON.stringify(wrangler, null, 2) + "\n");
  for (const [target, content] of outputs) {
    const path = resolve(directory, target);
    writeFileSync(path, content);
    if (target.endsWith("/.env") || target === ".env" || target.startsWith("ssg/.env.")) chmodSync(path, 0o600);
    console.log(`generated ${target}`);
  }
  return [...outputs.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    initialize();
  } catch (error) {
    console.error(`init-env failed: ${error.message}`);
    process.exitCode = 1;
  }
}
