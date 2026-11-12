import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const release = JSON.parse(await readFile(new URL("../../licenses/emulatorjs.json", import.meta.url), "utf8"));
const prefix = `/lib/emulatorjs/${release.version}/data/`;
const types = { ".js": "application/javascript", ".json": "application/json", ".css": "text/css", ".wasm": "application/wasm", ".zip": "application/zip" };
const cache = new Map();

async function resource(path) {
  // Serve the prepared release on another origin without depending on the CDN.
  return readFile(new URL(`../../public/emulatorjs/data/${path}`, import.meta.url));
}

createServer(async (request, response) => {
  // Model a public CDN with CORS, deliberately without CORP or COEP.
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Expose-Headers", "Content-Length, ETag");
  if (request.url === "/health") return response.end("ok");
  const pathname = new URL(request.url, "http://127.0.0.1:4174").pathname;
  const path = pathname.slice(prefix.length);
  if (!pathname.startsWith(prefix) || !/^[\w./-]+$/.test(path) || path.split("/").includes("..") || path.startsWith("/")) {
    response.writeHead(404);
    return response.end();
  }
  try {
    if (!cache.has(path)) cache.set(path, resource(path).catch((error) => { cache.delete(path); throw error; }));
    const bytes = await cache.get(path);
    response.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
    response.setHeader("Content-Length", bytes.length);
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch (error) {
    console.error(error.message);
    response.writeHead(502);
    response.end("Emulator resource unavailable");
  }
}).listen(4174, "127.0.0.1");
