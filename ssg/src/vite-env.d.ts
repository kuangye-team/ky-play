/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "virtual:app-assets" {
  export const installManifest: Record<string, unknown>;
  export const controllerImage: string;
  export const gameCovers: Record<string, string>;
}
