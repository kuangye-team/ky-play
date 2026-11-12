import { minify } from "html-minifier-terser";
import type { Plugin } from "vite";

export function minifyHtml(html: string): Promise<string> {
  return minify(html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: true,
  });
}

export function htmlMinifier(): Plugin {
  return {
    name: "minify-html",
    apply: "build",
    generateBundle: {
      // Run after HTML injection, before files are written and the SW hashes them.
      order: "post",
      async handler(_, bundle) {
        for (const asset of Object.values(bundle)) {
          if (asset.type !== "asset" || !asset.fileName.endsWith(".html")) continue;
          const html = typeof asset.source === "string" ? asset.source : Buffer.from(asset.source).toString("utf8");
          asset.source = await minifyHtml(html);
        }
      },
    },
  };
}
